import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// DI scanner — enumerates what's reachable via the service locator so AI
// assistants know what to inject instead of instantiating new dependencies.
// Detects:
//   * GetIt registrations: getIt.registerSingleton<T>() / registerFactory<T>() / registerLazySingleton<T>()
//   * Injectable annotations: @injectable, @singleton, @lazySingleton, @module
//   * Riverpod top-level providers declared via Provider / FutureProvider / etc.

interface Registration {
  kind: string; // singleton | factory | lazySingleton | module
  type: string; // registered type
  file: string;
  tool: "get_it" | "injectable" | "riverpod";
}

function detectDiTool(pubspec: Record<string, unknown>): Set<string> {
  const deps = { ...(pubspec.dependencies as Record<string, unknown> | undefined), ...(pubspec.dev_dependencies as Record<string, unknown> | undefined) };
  const tools = new Set<string>();
  if (deps["get_it"]) tools.add("get_it");
  if (deps["injectable"]) tools.add("injectable");
  if (deps["flutter_riverpod"] || deps["riverpod"] || deps["hooks_riverpod"]) tools.add("riverpod");
  if (deps["provider"]) tools.add("provider");
  return tools;
}

function parseGetItRegistrations(content: string, filePath: string): Registration[] {
  const out: Registration[] = [];
  // Match: <ident>.register(Singleton|Factory|LazySingleton|SingletonAsync|FactoryAsync)<Type>(
  const re = /\w+\.register(Singleton|Factory|LazySingleton|SingletonAsync|FactoryAsync)\s*<\s*([\w<>?, ]+?)\s*>\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({
      kind: m[1].charAt(0).toLowerCase() + m[1].slice(1),
      type: m[2].trim(),
      file: filePath,
      tool: "get_it",
    });
  }
  // Also handle register() without generic — fall back to the call-site type if we can guess it
  // from the first positional argument. Keep this path lenient; many projects use the generic form.
  return out;
}

function parseInjectableAnnotations(content: string, filePath: string): Registration[] {
  const out: Registration[] = [];
  // Match an annotation, then the next `class Foo` / `abstract class Foo`
  const re = /@(injectable|singleton|lazySingleton|module|Injectable|Singleton|LazySingleton|Module)(?:\([^)]*\))?\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*((?:abstract\s+)?class\s+(\w+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    // Normalize annotation casing to the canonical form (camelCase for the
    // lowercase aliases, PascalCase kept as-is for the @-class variants).
    const raw = m[1];
    const canonical: Record<string, string> = {
      injectable: "injectable",
      singleton: "singleton",
      lazysingleton: "lazySingleton",
      module: "module",
    };
    const ann = canonical[raw.toLowerCase()] ?? raw;
    const className = m[3];
    let kind = ann;
    if (ann === "injectable") kind = "factory (default)";
    out.push({
      kind,
      type: className,
      file: filePath,
      tool: "injectable",
    });
  }
  return out;
}

function parseRiverpodProviders(content: string, filePath: string): Registration[] {
  const out: Registration[] = [];
  // final fooProvider = Provider<T>((ref) => ...)
  // Also matches: FutureProvider, StreamProvider, StateProvider, StateNotifierProvider,
  // NotifierProvider, AsyncNotifierProvider, ChangeNotifierProvider (and .family / .autoDispose variants).
  const re = /final\s+(\w+Provider)\s*=\s*((?:Async)?(?:State)?(?:Notifier|Change)?(?:Future|Stream|State)?Provider)(?:\.(?:family|autoDispose(?:\.family)?))?\s*(?:<\s*([\w<>?, ]+?)\s*>)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    const providerKind = m[2];
    const type = m[3]?.trim() ?? name;
    out.push({
      kind: providerKind,
      type: `${name}${m[3] ? ` <${type}>` : ""}`,
      file: filePath,
      tool: "riverpod",
    });
  }
  // @riverpod code-gen style: @riverpod T myFn(MyFnRef ref) => ...
  const codeGenRe = /@riverpod\b[^\n]*\n\s*(?:Future<|Stream<)?\s*([\w<>?, ]+?)\s+(\w+)\s*\(\s*\w+Ref/g;
  let cm: RegExpExecArray | null;
  while ((cm = codeGenRe.exec(content)) !== null) {
    out.push({
      kind: "@riverpod",
      type: `${cm[2]} → ${cm[1].trim()}`,
      file: filePath,
      tool: "riverpod",
    });
  }
  return out;
}

export async function scanDi(options: ScanOptions): Promise<ScanResult | null> {
  const pubspecPath = path.join(options.rootDir, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return null;
  let pubspec: Record<string, unknown>;
  try {
    pubspec = parseYaml(fs.readFileSync(pubspecPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const tools = detectDiTool(pubspec);
  if (tools.size === 0) return null;

  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  }).filter((f) => !f.endsWith(".g.dart") && !f.endsWith(".freezed.dart"));

  const registrations: Registration[] = [];
  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (tools.has("get_it")) registrations.push(...parseGetItRegistrations(content, filePath));
    if (tools.has("injectable")) registrations.push(...parseInjectableAnnotations(content, filePath));
    if (tools.has("riverpod")) registrations.push(...parseRiverpodProviders(content, filePath));
  }

  if (registrations.length === 0) return null;

  const sections: string[] = [heading(1, "Dependency Injection")];

  const toolList = [...tools].join(", ");
  sections.push(`**Tools detected:** ${toolList}`);

  // Group by tool, then file
  const byTool: Record<string, Registration[]> = {};
  for (const r of registrations) {
    if (!byTool[r.tool]) byTool[r.tool] = [];
    byTool[r.tool].push(r);
  }

  for (const [tool, regs] of Object.entries(byTool)) {
    const toolHeader = tool === "get_it" ? "GetIt" : tool === "injectable" ? "Injectable" : "Riverpod";
    sections.push(heading(2, toolHeader));

    // Group by directory (relative)
    const byDir: Record<string, Registration[]> = {};
    for (const r of regs) {
      const rel = path.relative(options.rootDir, r.file).replace(/\\/g, "/");
      const dir = path.dirname(rel);
      if (!byDir[dir]) byDir[dir] = [];
      byDir[dir].push({ ...r, file: rel });
    }
    for (const [dir, drs] of Object.entries(byDir).sort()) {
      const lines = drs.map((r) => `${r.type} [${r.kind}]`);
      sections.push(joinSections(heading(3, dir), bulletList(lines)));
    }
  }

  return {
    filename: "di.md",
    content: sections.join("\n\n") + "\n",
  };
}
