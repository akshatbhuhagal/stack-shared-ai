import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Read the package.json `exports` / `main` / `module` / `types` fields and
// summarize the package's public entry points. This is the canonical place to
// look at when learning what a TS library exposes.
export async function scanExports(options: ScanOptions): Promise<ScanResult | null> {
  const pkgPath = path.join(options.rootDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }

  const sections: string[] = [heading(1, "Package Exports")];

  // Top-level metadata
  const meta: string[] = [];
  if (typeof pkg.name === "string") meta.push(`name: ${pkg.name}`);
  if (typeof pkg.version === "string") meta.push(`version: ${pkg.version}`);
  if (typeof pkg.type === "string") meta.push(`module type: ${pkg.type}`);
  if (typeof pkg.main === "string") meta.push(`main: ${pkg.main}`);
  if (typeof pkg.module === "string") meta.push(`module: ${pkg.module}`);
  if (typeof pkg.types === "string") meta.push(`types: ${pkg.types}`);
  if (typeof pkg.typings === "string") meta.push(`typings: ${pkg.typings}`);
  if (Array.isArray(pkg.files)) meta.push(`files: ${(pkg.files as string[]).join(", ")}`);
  if (meta.length > 0) {
    sections.push(joinSections(heading(2, "Package"), bulletList(meta)));
  }

  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === "object") {
    const lines: string[] = [];
    for (const [subpath, target] of Object.entries(exportsField as Record<string, unknown>)) {
      if (typeof target === "string") {
        lines.push(`\`${subpath}\` → ${target}`);
      } else if (target && typeof target === "object") {
        // Conditional exports: { import, require, types, default }
        const conds = Object.entries(target as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => `${k}: ${v}`);
        lines.push(`\`${subpath}\` — ${conds.join("; ")}`);
      }
    }
    if (lines.length > 0) {
      sections.push(joinSections(heading(2, "Subpath Exports"), bulletList(lines)));
    }
  } else if (typeof exportsField === "string") {
    sections.push(joinSections(heading(2, "Subpath Exports"), `- \`.\` → ${exportsField}`));
  }

  // Bin entries
  if (pkg.bin) {
    const lines: string[] = [];
    if (typeof pkg.bin === "string") {
      lines.push(`\`${pkg.name}\` → ${pkg.bin}`);
    } else if (typeof pkg.bin === "object") {
      for (const [name, target] of Object.entries(pkg.bin as Record<string, string>)) {
        lines.push(`\`${name}\` → ${target}`);
      }
    }
    if (lines.length > 0) {
      sections.push(joinSections(heading(2, "Binaries"), bulletList(lines)));
    }
  }

  if (sections.length === 1) return null;

  return {
    filename: "exports.md",
    content: sections.join("\n\n") + "\n",
  };
}
