import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList, codeBlock } from "../../utils/markdown";

function findMiddlewareFile(rootDir: string): string | null {
  const candidates = [
    "middleware.ts", "middleware.js",
    "src/middleware.ts", "src/middleware.js",
  ];
  for (const c of candidates) {
    const full = path.join(rootDir, c);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Extract `export const config = { ... }` block (balanced braces).
function extractConfigBlock(content: string): string | null {
  const idx = content.search(/export\s+const\s+config\s*=\s*\{/);
  if (idx === -1) return null;
  const braceStart = content.indexOf("{", idx);
  if (braceStart === -1) return null;
  let depth = 1;
  let i = braceStart + 1;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) break;
    i++;
  }
  return content.slice(braceStart, i + 1);
}

function extractMatchers(configBlock: string): string[] {
  // Match `matcher: '...'` or `matcher: ['...', '...']`
  const matchers: string[] = [];
  const single = configBlock.match(/matcher\s*:\s*['"`]([^'"`]+)['"`]/);
  if (single) matchers.push(single[1]);
  const arr = configBlock.match(/matcher\s*:\s*\[([\s\S]*?)\]/);
  if (arr) {
    const re = /['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = re.exec(arr[1])) !== null) matchers.push(m[1]);
  }
  return matchers;
}

export async function scanMiddleware(options: ScanOptions): Promise<ScanResult | null> {
  const file = findMiddlewareFile(options.rootDir);
  if (!file) return null;

  let content: string;
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  const rel = path.relative(options.rootDir, file).replace(/\\/g, "/");
  const sections: string[] = [
    heading(1, "Middleware"),
    `Source: \`${rel}\``,
  ];

  // Default export name (function or const)
  const defaultFn = content.match(/export\s+default\s+(?:async\s+)?function\s+(\w+)/);
  const defaultConst = content.match(/export\s+default\s+(\w+)/);
  const middlewareName = defaultFn?.[1] ?? defaultConst?.[1] ?? "<default export>";
  sections.push(joinSections(heading(2, "Entry"), `- ${middlewareName}`));

  const configBlock = extractConfigBlock(content);
  if (configBlock) {
    const matchers = extractMatchers(configBlock);
    if (matchers.length > 0) {
      sections.push(joinSections(heading(2, "Matchers"), bulletList(matchers)));
    } else {
      sections.push(joinSections(heading(2, "Config"), codeBlock(configBlock, "ts")));
    }
  }

  return {
    filename: "middleware.md",
    content: sections.join("\n\n") + "\n",
  };
}
