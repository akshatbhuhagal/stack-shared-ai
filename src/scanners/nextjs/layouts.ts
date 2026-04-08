import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, bulletList } from "../../utils/markdown";

const SPECIAL_FILES = ["layout", "template", "loading", "error", "not-found", "global-error"];

interface SpecialEntry {
  dir: string;        // relative to app root, "" for root
  files: string[];    // names found, e.g. ["layout", "loading"]
}

function findAppDir(rootDir: string): { dir: string; label: string } | null {
  const candidates = [
    { dir: path.join(rootDir, "app"), label: "app/" },
    { dir: path.join(rootDir, "src", "app"), label: "src/app/" },
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.dir) && fs.statSync(c.dir).isDirectory()) return c;
  }
  return null;
}

function walk(appDir: string, baseDir: string, out: SpecialEntry[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appDir, { withFileTypes: true });
  } catch {
    return;
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(appDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      walk(full, baseDir, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const m = entry.name.match(/^([a-z-]+)\.(t|j)sx?$/);
    if (m && SPECIAL_FILES.includes(m[1])) {
      found.push(m[1]);
    }
  }
  if (found.length > 0) {
    const rel = path.relative(baseDir, appDir).replace(/\\/g, "/");
    out.push({ dir: rel, files: found.sort() });
  }
}

export async function scanLayouts(options: ScanOptions): Promise<ScanResult | null> {
  const found = findAppDir(options.rootDir);
  if (!found) return null;

  const entries: SpecialEntry[] = [];
  walk(found.dir, found.dir, entries);
  if (entries.length === 0) return null;

  entries.sort((a, b) => a.dir.localeCompare(b.dir));

  const lines = entries.map((e) => {
    const dirLabel = e.dir === "" ? `${found.label}` : `${found.label}${e.dir}/`;
    return `\`${dirLabel}\` — ${e.files.join(", ")}`;
  });

  const content = [
    heading(1, "Layouts & Special Files"),
    bulletList(lines),
  ].join("\n\n") + "\n";

  return { filename: "layouts.md", content };
}
