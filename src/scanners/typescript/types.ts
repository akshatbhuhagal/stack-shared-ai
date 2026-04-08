import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

interface TypeDecl {
  kind: "interface" | "type" | "enum";
  name: string;
  generics: string;
  file: string;
  preview: string;
}

// Walk balanced braces from a position pointing at `{`. Returns the index AFTER
// the matching `}`, or -1 if unbalanced.
function skipBraces(content: string, start: number): number {
  let d = 1;
  let i = start + 1;
  while (i < content.length && d > 0) {
    const c = content[i];
    if (c === "{") d++;
    else if (c === "}") d--;
    if (d === 0) return i + 1;
    i++;
  }
  return -1;
}

function extractTypes(content: string, relFile: string): TypeDecl[] {
  const out: TypeDecl[] = [];

  // export interface Name<T> { ... }
  const ifaceRe = /export\s+interface\s+(\w+)(<[^>]*>)?\s*(?:extends\s+[^{]+)?\{/g;
  let m;
  while ((m = ifaceRe.exec(content)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    const end = skipBraces(content, braceStart);
    const body = end !== -1 ? content.slice(braceStart + 1, end - 1) : "";
    const fields = body
      .split(/[;\n]/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*"));
    out.push({
      kind: "interface",
      name: m[1],
      generics: m[2] ?? "",
      file: relFile,
      preview: fields.length > 0 ? `${fields.length} field(s)` : "",
    });
  }

  // export type Name<T> = ...
  const typeRe = /export\s+type\s+(\w+)(<[^>]*>)?\s*=\s*([^;\n]+)/g;
  while ((m = typeRe.exec(content)) !== null) {
    out.push({
      kind: "type",
      name: m[1],
      generics: m[2] ?? "",
      file: relFile,
      preview: m[3].trim().slice(0, 60),
    });
  }

  // export enum Name { ... }
  const enumRe = /export\s+(?:const\s+)?enum\s+(\w+)\s*\{/g;
  while ((m = enumRe.exec(content)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    const end = skipBraces(content, braceStart);
    const body = end !== -1 ? content.slice(braceStart + 1, end - 1) : "";
    const members = body
      .split(",")
      .map((l) => l.trim().split(/[\s=]/)[0])
      .filter((l) => l && /^\w/.test(l));
    out.push({
      kind: "enum",
      name: m[1],
      generics: "",
      file: relFile,
      preview: members.length > 0 ? `{ ${members.join(", ")} }` : "",
    });
  }

  return out;
}

export async function scanTypes(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".tsx", ".d.ts"],
  });

  const all: TypeDecl[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!/export\s+(interface|type|enum|const enum)\b/.test(content)) continue;
    const rel = path.relative(options.rootDir, file).replace(/\\/g, "/");
    all.push(...extractTypes(content, rel));
  }

  if (all.length === 0) return null;

  // Group by file
  const byFile: Record<string, TypeDecl[]> = {};
  for (const t of all) {
    if (!byFile[t.file]) byFile[t.file] = [];
    byFile[t.file].push(t);
  }

  const sections: string[] = [heading(1, "Types")];

  for (const file of Object.keys(byFile).sort()) {
    const items = byFile[file]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const sig = `${t.name}${t.generics}`;
        const tag = `(${t.kind})`;
        return t.preview ? `${tag} ${sig} — ${t.preview}` : `${tag} ${sig}`;
      });
    sections.push(joinSections(heading(3, `\`${file}\``), bulletList(items)));
  }

  return {
    filename: "types.md",
    content: sections.join("\n\n") + "\n",
  };
}
