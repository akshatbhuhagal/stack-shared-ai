import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

interface Component {
  name: string;
  file: string;
  isClient: boolean;
}

// Heuristic: a "component" is an exported function/const that returns JSX OR
// the default export of a file under components/. We don't fully parse — we
// look for `export default function Foo` / `export function Foo` / `export const Foo =`.
function extractComponentsFromFile(content: string, relFile: string): Component[] {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  const isClient = /^['"`]use client['"`];?/.test(trimmed);

  const out: Component[] = [];
  const seen = new Set<string>();

  const push = (name: string) => {
    // PascalCase only — components conventionally start uppercase
    if (!/^[A-Z]/.test(name)) return;
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, file: relFile, isClient });
  };

  // export default function Name(
  let m;
  const defFnRe = /export\s+default\s+function\s+(\w+)/g;
  while ((m = defFnRe.exec(content)) !== null) push(m[1]);

  // export function Name(
  const fnRe = /export\s+function\s+(\w+)/g;
  while ((m = fnRe.exec(content)) !== null) push(m[1]);

  // export const Name = ( ...  or  export const Name: FC = (
  const constRe = /export\s+const\s+(\w+)\s*(?::\s*[\w<>.,\s]+)?\s*=\s*(?:\(|React\.forwardRef|forwardRef|memo\()/g;
  while ((m = constRe.exec(content)) !== null) push(m[1]);

  return out;
}

// Decide whether a file is plausibly a component file. Cheap filter to avoid
// scanning every utility file.
function looksLikeComponentFile(file: string, content: string): boolean {
  if (/[\\/](components|ui|widgets)[\\/]/i.test(file)) return true;
  if (/\.tsx$|\.jsx$/.test(file)) return true; // .tsx/.jsx are usually components
  // .ts/.js: only if file contains JSX-ish or use client
  return /use client/.test(content);
}

export async function scanComponents(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".tsx", ".jsx", ".ts", ".js"],
  });

  const all: Component[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!looksLikeComponentFile(file, content)) continue;
    // Skip Next.js special files we already cover in routes.md / layouts.md
    const base = path.basename(file);
    if (/^(page|layout|template|loading|error|not-found|global-error|route|middleware)\.(t|j)sx?$/.test(base)) continue;

    const rel = path.relative(options.rootDir, file).replace(/\\/g, "/");
    all.push(...extractComponentsFromFile(content, rel));
  }

  if (all.length === 0) return null;

  // Group by directory
  const byDir: Record<string, Component[]> = {};
  for (const c of all) {
    const dir = path.posix.dirname(c.file) || ".";
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(c);
  }

  const sections: string[] = [heading(1, "Components")];

  for (const dir of Object.keys(byDir).sort()) {
    const items = byDir[dir]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `${c.isClient ? "(client) " : "(server) "}${c.name}`);
    sections.push(joinSections(heading(3, `\`${dir}/\``), bulletList(items)));
  }

  return {
    filename: "components.md",
    content: sections.join("\n\n") + "\n",
  };
}
