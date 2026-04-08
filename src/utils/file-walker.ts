import * as fs from "fs";
import * as path from "path";

export interface WalkOptions {
  include?: string[];
  exclude?: string[];
  extensions?: string[];
}

export function walkFiles(rootDir: string, options: WalkOptions = {}): string[] {
  const { include = [], exclude = [], extensions = [] } = options;
  const results: string[] = [];

  const defaultExclude = new Set([
    "node_modules", ".dart_tool", "build", "dist", ".git",
    ".idea", ".vscode", "__pycache__", ".gradle",
  ]);

  const excludeSet = new Set([...defaultExclude, ...exclude]);

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (excludeSet.has(entry.name)) continue;
        // If include list is specified, check if this directory path starts with any include path
        if (include.length > 0) {
          const isIncluded = include.some(
            (inc) => relativePath.startsWith(inc) || inc.startsWith(relativePath)
          );
          if (!isIncluded) continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (extensions.length > 0) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!extensions.includes(ext)) continue;
        }
        if (include.length > 0) {
          const isIncluded = include.some((inc) => relativePath.startsWith(inc));
          if (!isIncluded) continue;
        }
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results;
}
