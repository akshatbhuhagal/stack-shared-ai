import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Extracts declared assets (images, fonts, icons) from pubspec.yaml. AI
// assistants routinely need this list when generating UI that references
// existing art. We also count files in common asset dirs as a sanity check
// so the output reflects what's actually on disk, not just the manifest.

interface FontEntry {
  family: string;
  assets: string[];
}

function isAssetDir(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  return ["assets", "asset", "images", "img", "icons", "fonts", "animations", "lottie"].includes(base);
}

function countFilesIn(dir: string): { total: number; byExt: Record<string, number> } {
  const byExt: Record<string, number> = {};
  let total = 0;
  function walk(d: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(path.join(d, e.name));
      } else if (e.isFile()) {
        total++;
        const ext = path.extname(e.name).toLowerCase() || "(none)";
        byExt[ext] = (byExt[ext] ?? 0) + 1;
      }
    }
  }
  walk(dir);
  return { total, byExt };
}

export async function scanAssets(options: ScanOptions): Promise<ScanResult | null> {
  const pubspecPath = path.join(options.rootDir, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return null;

  let pubspec: Record<string, unknown>;
  try {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    pubspec = parseYaml(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const flutter = (pubspec.flutter ?? {}) as Record<string, unknown>;
  const declaredAssets = Array.isArray(flutter.assets) ? (flutter.assets as unknown[]).map(String) : [];
  const fontsRaw = Array.isArray(flutter.fonts) ? (flutter.fonts as unknown[]) : [];

  const fonts: FontEntry[] = [];
  for (const f of fontsRaw) {
    if (typeof f !== "object" || f === null) continue;
    const fam = (f as Record<string, unknown>).family;
    const assets = (f as Record<string, unknown>).fonts;
    if (typeof fam !== "string") continue;
    const paths: string[] = [];
    if (Array.isArray(assets)) {
      for (const a of assets) {
        if (typeof a === "object" && a !== null && typeof (a as Record<string, unknown>).asset === "string") {
          paths.push((a as Record<string, unknown>).asset as string);
        }
      }
    }
    fonts.push({ family: fam, assets: paths });
  }

  // Walk top-level asset directories for on-disk counts (helps when pubspec
  // uses directory entries like "assets/images/" without listing every file).
  const topLevelDirs: string[] = [];
  try {
    for (const e of fs.readdirSync(options.rootDir, { withFileTypes: true })) {
      if (e.isDirectory() && isAssetDir(e.name)) topLevelDirs.push(e.name);
    }
  } catch {
    /* ignore */
  }

  const dirStats: { dir: string; total: number; byExt: Record<string, number> }[] = [];
  for (const d of topLevelDirs) {
    const stats = countFilesIn(path.join(options.rootDir, d));
    if (stats.total > 0) dirStats.push({ dir: d, ...stats });
  }

  if (declaredAssets.length === 0 && fonts.length === 0 && dirStats.length === 0) {
    return null;
  }

  const sections: string[] = [heading(1, "Assets")];

  if (declaredAssets.length > 0) {
    sections.push(joinSections(heading(2, "Declared Assets (pubspec.yaml)"), bulletList(declaredAssets)));
  }

  if (dirStats.length > 0) {
    const lines = dirStats.map((s) => {
      const extSummary = Object.entries(s.byExt)
        .sort((a, b) => b[1] - a[1])
        .map(([ext, n]) => `${ext}: ${n}`)
        .join(", ");
      return `${s.dir}/ — ${s.total} file${s.total === 1 ? "" : "s"} (${extSummary})`;
    });
    sections.push(joinSections(heading(2, "On-disk Asset Directories"), bulletList(lines)));
  }

  if (fonts.length > 0) {
    const fontSections: string[] = [heading(2, "Fonts")];
    for (const f of fonts) {
      const lines = f.assets.length > 0 ? f.assets.map((a) => `- ${a}`).join("\n") : "- (no asset files listed)";
      fontSections.push(`**${f.family}**\n${lines}`);
    }
    sections.push(fontSections.join("\n\n"));
  }

  return {
    filename: "assets.md",
    content: sections.join("\n\n") + "\n",
  };
}
