import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading } from "../../utils/markdown";
import { walkFiles } from "../../utils/file-walker";

interface ModuleInfo {
  name: string;
  file: string;
  imports: string[];
  controllers: string[];
  providers: string[];
  exports: string[];
}

// Extract a balanced-brace block starting at the first "{" found after `from`.
function extractBracedBlock(content: string, from: number): { body: string; end: number } | null {
  const start = content.indexOf("{", from);
  if (start === -1) return null;
  let depth = 1;
  let i = start + 1;
  while (i < content.length && depth > 0) {
    const c = content[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth === 0) break;
    i++;
  }
  return { body: content.slice(start + 1, i), end: i + 1 };
}

// Extract a balanced-bracket array for a given key, e.g. `imports: [A, B, C]`
function extractArray(block: string, key: string): string[] {
  const re = new RegExp(`${key}\\s*:\\s*\\[`);
  const m = re.exec(block);
  if (!m) return [];
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < block.length && depth > 0) {
    const c = block[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    if (depth === 0) break;
    i++;
  }
  const inner = block.slice(start, i);
  // Split on top-level commas (crude: ignore nested parens/braces)
  const items: string[] = [];
  let buf = "";
  let parenDepth = 0;
  let braceDepth = 0;
  for (const c of inner) {
    if (c === "(" || c === "[") parenDepth++;
    else if (c === ")" || c === "]") parenDepth--;
    else if (c === "{") braceDepth++;
    else if (c === "}") braceDepth--;
    if (c === "," && parenDepth === 0 && braceDepth === 0) {
      if (buf.trim()) items.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) items.push(buf.trim());
  // Shorten: keep identifier / class name, drop arg lists
  return items.map((s) => {
    const simple = s.match(/^(\w[\w.]*)/);
    return simple ? s : s.slice(0, 60);
  });
}

export async function scanModules(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts"],
  }).filter((f) => !f.endsWith(".d.ts") && !f.endsWith(".spec.ts"));

  const modules: ModuleInfo[] = [];
  const moduleRe = /@Module\s*\(\s*\{/g;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!content.includes("@Module")) continue;

    moduleRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = moduleRe.exec(content)) !== null) {
      const block = extractBracedBlock(content, m.index);
      if (!block) continue;
      // After the block, find `export class Name`
      const tail = content.slice(block.end, block.end + 500);
      const classMatch = tail.match(/export\s+class\s+(\w+)/);
      if (!classMatch) continue;

      modules.push({
        name: classMatch[1],
        file: path.relative(options.rootDir, file).replace(/\\/g, "/"),
        imports: extractArray(block.body, "imports"),
        controllers: extractArray(block.body, "controllers"),
        providers: extractArray(block.body, "providers"),
        exports: extractArray(block.body, "exports"),
      });
    }
  }

  if (modules.length === 0) return null;

  modules.sort((a, b) => a.name.localeCompare(b.name));

  const sections: string[] = [heading(1, "Modules")];
  for (const mod of modules) {
    sections.push(heading(2, mod.name));
    const lines = [`_${mod.file}_`];
    if (mod.imports.length > 0) lines.push(`- **imports:** ${mod.imports.join(", ")}`);
    if (mod.controllers.length > 0) lines.push(`- **controllers:** ${mod.controllers.join(", ")}`);
    if (mod.providers.length > 0) lines.push(`- **providers:** ${mod.providers.join(", ")}`);
    if (mod.exports.length > 0) lines.push(`- **exports:** ${mod.exports.join(", ")}`);
    sections.push(lines.join("\n"));
  }

  return {
    filename: "modules.md",
    content: sections.join("\n\n") + "\n",
  };
}
