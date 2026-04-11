import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// App entry scanner — reads main.dart / app.dart to surface:
//   * the root widget (MaterialApp / MaterialApp.router / CupertinoApp)
//   * ProviderScope / MultiProvider / MultiBlocProvider wrappers at root
//   * key bootstrap calls (WidgetsFlutterBinding.ensureInitialized, Firebase.initializeApp,
//     runZonedGuarded, setPreferredOrientations, HydratedBloc.storage, etc.)
//   * router + theme wiring
//
// AI assistants need this to know where to plug new global setup without
// guessing at the app's bootstrap style.

const ENTRY_CANDIDATES = [
  "lib/main.dart",
  "lib/app.dart",
  "lib/src/app.dart",
  "lib/src/app/app.dart",
  "lib/src/app/view/app.dart",
  "lib/bootstrap.dart",
  "lib/src/bootstrap.dart",
];

interface AppFacts {
  filePath: string;
  rootWidget: string | null;
  routerMode: "router" | "classic" | null;
  wrappers: string[];
  bootstrapCalls: string[];
  themeRefs: string[];
  localeRefs: string[];
}

const BOOTSTRAP_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "WidgetsFlutterBinding.ensureInitialized()", re: /WidgetsFlutterBinding\.ensureInitialized\s*\(/ },
  { label: "Firebase.initializeApp()", re: /Firebase\.initializeApp\s*\(/ },
  { label: "runZonedGuarded()", re: /runZonedGuarded\s*\(/ },
  { label: "SystemChrome.setPreferredOrientations()", re: /SystemChrome\.setPreferredOrientations\s*\(/ },
  { label: "HydratedBloc.storage", re: /HydratedBloc\.storage\s*=/ },
  { label: "Hive.initFlutter()", re: /Hive\.initFlutter\s*\(/ },
  { label: "GetIt configureDependencies()", re: /configureDependencies\s*\(/ },
  { label: "EasyLocalization.ensureInitialized()", re: /EasyLocalization\.ensureInitialized\s*\(/ },
  { label: "SentryFlutter.init()", re: /SentryFlutter\.init\s*\(/ },
  { label: "await dotenv.load", re: /dotenv\.load\s*\(/ },
];

const WRAPPER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "ProviderScope", re: /ProviderScope\s*\(/ },
  { label: "MultiProvider", re: /MultiProvider\s*\(/ },
  { label: "MultiBlocProvider", re: /MultiBlocProvider\s*\(/ },
  { label: "MultiRepositoryProvider", re: /MultiRepositoryProvider\s*\(/ },
  { label: "EasyLocalization", re: /EasyLocalization\s*\(/ },
  { label: "ScreenUtilInit", re: /ScreenUtilInit\s*\(/ },
];

function extractAppFacts(filePath: string, content: string): AppFacts {
  const facts: AppFacts = {
    filePath,
    rootWidget: null,
    routerMode: null,
    wrappers: [],
    bootstrapCalls: [],
    themeRefs: [],
    localeRefs: [],
  };

  // Root widget: first MaterialApp / MaterialApp.router / CupertinoApp / WidgetsApp call
  const rootRe = /(MaterialApp\.router|MaterialApp|CupertinoApp\.router|CupertinoApp|WidgetsApp\.router|WidgetsApp)\s*\(/;
  const rm = rootRe.exec(content);
  if (rm) {
    facts.rootWidget = rm[1];
    facts.routerMode = rm[1].endsWith(".router") ? "router" : "classic";
  }

  for (const { label, re } of BOOTSTRAP_PATTERNS) {
    if (re.test(content)) facts.bootstrapCalls.push(label);
  }
  for (const { label, re } of WRAPPER_PATTERNS) {
    if (re.test(content)) facts.wrappers.push(label);
  }

  // Extract a named argument whose value may span brackets/parens.
  // Returns a trimmed, collapsed-to-single-line string.
  function extractNamedArg(name: string): string | null {
    const re = new RegExp(`\\b${name}\\s*:\\s*`, "g");
    const m = re.exec(content);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 0;
    const start = i;
    while (i < content.length) {
      const c = content[i];
      if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
      else if (c === ")" || c === "]" || c === "}" || c === ">") {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
      else if (c === "\n" && depth === 0) break;
      i++;
    }
    return content.slice(start, i).trim().replace(/\s+/g, " ");
  }

  for (const k of ["theme", "darkTheme", "themeMode"]) {
    const v = extractNamedArg(k);
    if (v) facts.themeRefs.push(`${k}: ${v}`);
  }
  for (const k of ["locale", "supportedLocales", "localizationsDelegates", "localeResolutionCallback"]) {
    const v = extractNamedArg(k);
    if (v) facts.localeRefs.push(`${k}: ${v}`);
  }

  return facts;
}

export async function scanApp(options: ScanOptions): Promise<ScanResult | null> {
  const rootDir = options.rootDir;

  // Find all candidate entry files that actually exist
  const entries: string[] = [];
  for (const rel of ENTRY_CANDIDATES) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) entries.push(abs);
  }

  // Also discover additional files that reference MaterialApp (catches custom layouts).
  // Limit the walk to `lib/` to avoid scanning the whole tree a second time.
  const libDir = path.join(rootDir, "lib");
  if (fs.existsSync(libDir)) {
    const dartFiles = walkFiles(libDir, {
      include: options.include,
      exclude: options.exclude,
      extensions: [".dart"],
    }).filter((f) => !f.endsWith(".g.dart") && !f.endsWith(".freezed.dart"));
    for (const f of dartFiles) {
      if (entries.includes(f)) continue;
      try {
        const content = fs.readFileSync(f, "utf-8");
        if (/(MaterialApp|CupertinoApp|WidgetsApp)\s*(?:\.\w+)?\s*\(/.test(content)) {
          entries.push(f);
        }
      } catch {
        /* ignore */
      }
      // Cap scanning at a few files to keep this cheap
      if (entries.length >= 6) break;
    }
  }

  if (entries.length === 0) return null;

  const facts: AppFacts[] = [];
  for (const f of entries) {
    try {
      const c = fs.readFileSync(f, "utf-8");
      facts.push(extractAppFacts(f, c));
    } catch {
      /* ignore */
    }
  }

  const relevant = facts.filter(
    (f) => f.rootWidget || f.wrappers.length > 0 || f.bootstrapCalls.length > 0,
  );
  if (relevant.length === 0) return null;

  const sections: string[] = [heading(1, "App Entry")];

  for (const f of relevant) {
    const rel = path.relative(rootDir, f.filePath).replace(/\\/g, "/");
    const lines: string[] = [];
    if (f.rootWidget) {
      const routerNote = f.routerMode === "router" ? " (router mode — uses go_router/auto_route)" : "";
      lines.push(`**Root widget:** ${f.rootWidget}${routerNote}`);
    }
    if (f.wrappers.length > 0) lines.push(`**Wrappers:** ${f.wrappers.join(", ")}`);
    if (f.bootstrapCalls.length > 0) {
      lines.push("**Bootstrap:**");
      for (const b of f.bootstrapCalls) lines.push(`- ${b}`);
    }
    if (f.themeRefs.length > 0) {
      lines.push("**Theme wiring:**");
      for (const t of f.themeRefs) lines.push(`- ${t}`);
    }
    if (f.localeRefs.length > 0) {
      lines.push("**Locale wiring:**");
      for (const l of f.localeRefs) lines.push(`- ${l}`);
    }
    sections.push(joinSections(heading(2, rel), lines.join("\n")));
  }

  return {
    filename: "app.md",
    content: sections.join("\n\n") + "\n",
  };
}
