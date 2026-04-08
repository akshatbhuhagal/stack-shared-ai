import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

interface Action {
  name: string;
  file: string;
  signature: string;
}

// Detects "use server" — either as a top-of-file directive (whole file is server actions)
// or per-function (function body starts with "use server"). Returns exported async functions.
function findActionsInFile(content: string, relFile: string): Action[] {
  const actions: Action[] = [];
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  const fileLevel = /^['"`]use server['"`];?/.test(trimmed);

  // Match exported async functions: export async function NAME(...args)
  const fnRe = /export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = fnRe.exec(content)) !== null) {
    const name = m[1];
    const params = m[2].trim();
    if (fileLevel || hasInlineUseServer(content, m.index + m[0].length)) {
      actions.push({ name, file: relFile, signature: `${name}(${params})` });
    }
  }

  // Match exported const arrow async fns: export const NAME = async (...) => { "use server"; ... }
  const constRe = /export\s+const\s+(\w+)\s*=\s*async\s*\(([^)]*)\)\s*=>\s*\{/g;
  while ((m = constRe.exec(content)) !== null) {
    const name = m[1];
    const params = m[2].trim();
    if (fileLevel || hasInlineUseServer(content, m.index + m[0].length)) {
      actions.push({ name, file: relFile, signature: `${name}(${params})` });
    }
  }

  return actions;
}

function hasInlineUseServer(content: string, fnBodyStart: number): boolean {
  // Look at the next ~80 chars after "{" for a "use server" directive at the body top.
  const slice = content.slice(fnBodyStart, fnBodyStart + 120);
  return /^\s*['"`]use server['"`]/.test(slice);
}

export async function scanServerActions(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  });

  const allActions: Action[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!/use server/.test(content)) continue;
    const rel = path.relative(options.rootDir, file).replace(/\\/g, "/");
    allActions.push(...findActionsInFile(content, rel));
  }

  if (allActions.length === 0) return null;

  // Group by file
  const byFile: Record<string, Action[]> = {};
  for (const a of allActions) {
    if (!byFile[a.file]) byFile[a.file] = [];
    byFile[a.file].push(a);
  }

  const sections: string[] = [heading(1, "Server Actions")];
  for (const file of Object.keys(byFile).sort()) {
    sections.push(joinSections(
      heading(3, `\`${file}\``),
      bulletList(byFile[file].map((a) => a.signature)),
    ));
  }

  return {
    filename: "server-actions.md",
    content: sections.join("\n\n") + "\n",
  };
}
