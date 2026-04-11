import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// l10n scanner — surfaces the app's localization setup so AI assistants know
// which locales exist and which keys are available before generating strings.
// Sources, in order of preference:
//   1. l10n.yaml config (arb-dir, template-arb-file, output-class)
//   2. .arb files anywhere in the project (lib/l10n, lib/src/localization, etc.)
//   3. easy_localization JSON under assets/translations/
//   4. intl package usage (Intl.message) as a fallback signal

const ARB_FILENAME_RE = /^(?:intl_|app_)?([a-z]{2}(?:_[A-Z]{2})?)\.arb$/;

interface ArbFile {
  locale: string;
  filePath: string;
  keyCount: number;
  sampleKeys: string[];
}

function parseArbFile(filePath: string): ArbFile | null {
  const base = path.basename(filePath);
  const match = ARB_FILENAME_RE.exec(base);
  if (!match) return null;
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Real keys: skip @@meta and @foo metadata
  const keys = Object.keys(obj).filter((k) => !k.startsWith("@"));
  return {
    locale: match[1],
    filePath,
    keyCount: keys.length,
    sampleKeys: keys.slice(0, 10),
  };
}

export async function scanL10n(options: ScanOptions): Promise<ScanResult | null> {
  const rootDir = options.rootDir;

  // 1. l10n.yaml
  let l10nConfig: Record<string, unknown> | null = null;
  const l10nYamlPath = path.join(rootDir, "l10n.yaml");
  if (fs.existsSync(l10nYamlPath)) {
    try {
      const raw = fs.readFileSync(l10nYamlPath, "utf-8");
      l10nConfig = parseYaml(raw) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }

  // 2. Walk for .arb files
  const allFiles = walkFiles(rootDir, {
    include: options.include,
    exclude: options.exclude,
  });
  const arbFiles: ArbFile[] = [];
  for (const f of allFiles) {
    if (!f.endsWith(".arb")) continue;
    const parsed = parseArbFile(f);
    if (parsed) arbFiles.push(parsed);
  }

  // 3. easy_localization JSONs in assets/translations
  const easyLocFiles: { locale: string; filePath: string; keyCount: number }[] = [];
  const translationsDirCandidates = [
    path.join(rootDir, "assets", "translations"),
    path.join(rootDir, "assets", "i18n"),
    path.join(rootDir, "assets", "lang"),
  ];
  for (const dir of translationsDirCandidates) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith(".json")) continue;
        const locale = entry.replace(/\.json$/, "");
        const filePath = path.join(dir, entry);
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          const obj = JSON.parse(raw) as Record<string, unknown>;
          const keyCount = Object.keys(obj).length;
          easyLocFiles.push({ locale, filePath, keyCount });
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 4. intl package Intl.message usage as fallback signal — only use if no arb/easy_loc found
  let intlCallCount = 0;
  if (arbFiles.length === 0 && easyLocFiles.length === 0) {
    const dartFiles = allFiles.filter(
      (f) => f.endsWith(".dart") && !f.endsWith(".g.dart") && !f.endsWith(".freezed.dart"),
    );
    for (const f of dartFiles) {
      try {
        const c = fs.readFileSync(f, "utf-8");
        const m = c.match(/Intl\.message\s*\(/g);
        if (m) intlCallCount += m.length;
      } catch {
        /* ignore */
      }
    }
  }

  if (!l10nConfig && arbFiles.length === 0 && easyLocFiles.length === 0 && intlCallCount === 0) {
    return null;
  }

  const sections: string[] = [heading(1, "Localization (l10n)")];

  if (l10nConfig) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(l10nConfig)) {
      lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
    sections.push(joinSections(heading(2, "l10n.yaml"), bulletList(lines)));
  }

  if (arbFiles.length > 0) {
    const sorted = [...arbFiles].sort((a, b) => a.locale.localeCompare(b.locale));
    const locales = [...new Set(sorted.map((a) => a.locale))];
    sections.push(joinSections(heading(2, "Detected Locales"), bulletList(locales)));

    const fileLines = sorted.map((a) => {
      const rel = path.relative(rootDir, a.filePath).replace(/\\/g, "/");
      return `${rel} (${a.locale}) — ${a.keyCount} key${a.keyCount === 1 ? "" : "s"}`;
    });
    sections.push(joinSections(heading(2, "ARB Files"), bulletList(fileLines)));

    // Sample keys from the first arb file (usually the template)
    const template = sorted[0];
    if (template.sampleKeys.length > 0) {
      sections.push(joinSections(heading(2, `Sample Keys (${template.locale})`), bulletList(template.sampleKeys)));
    }
  }

  if (easyLocFiles.length > 0) {
    const lines = easyLocFiles.map((e) => {
      const rel = path.relative(rootDir, e.filePath).replace(/\\/g, "/");
      return `${rel} (${e.locale}) — ${e.keyCount} key${e.keyCount === 1 ? "" : "s"}`;
    });
    sections.push(joinSections(heading(2, "easy_localization JSON"), bulletList(lines)));
  }

  if (intlCallCount > 0) {
    sections.push(joinSections(heading(2, "intl Package"), `Found ${intlCallCount} Intl.message() call${intlCallCount === 1 ? "" : "s"} (no .arb files detected).`));
  }

  return {
    filename: "l10n.md",
    content: sections.join("\n\n") + "\n",
  };
}
