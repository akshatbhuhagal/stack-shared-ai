import * as fs from "fs";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

interface MiddlewareEntry {
  name: string;
  args?: string;
  sourceFile: string;
}

// Locate app.use( calls; we balance parens manually to handle nested calls
// like app.use(cors({ origin: X })).
const USE_PREFIX = /\bapp\.use\s*\(/g;

function extractUseArgs(content: string, startAfterOpen: number): { args: string; end: number } | null {
  let depth = 1;
  let i = startAfterOpen;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  return { args: content.substring(startAfterOpen, i), end: i + 1 };
}

function isRouteMount(arg: string): boolean {
  // app.use('/path', someRouter) — first arg is a string path
  return /^\s*['"`]/.test(arg);
}

// Balance-aware extraction of `(...)` after a callee identifier.
function extractBalancedArgs(src: string, openIdx: number): { args: string; end: number } | null {
  if (src[openIdx] !== "(") return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  return { args: src.substring(openIdx + 1, i), end: i + 1 };
}

function extractMiddlewareName(expr: string): { name: string; args?: string } | null {
  expr = expr.trim();

  // callee pattern: `ident` or `ident.ident`
  const calleeMatch = expr.match(/^(\w+(?:\.\w+)?)/);
  if (!calleeMatch) return null;
  const name = calleeMatch[1];

  // Is it a call? e.g. `cors(...)` or just `authMiddleware`
  const afterCallee = expr.substring(name.length).trimStart();
  if (afterCallee.startsWith("(")) {
    const parenIdx = expr.indexOf("(", name.length);
    const extracted = extractBalancedArgs(expr, parenIdx);
    if (!extracted) return { name };
    let args = extracted.args.trim();
    // Truncate long arg lists
    if (args.length > 60) args = args.substring(0, 57) + "...";
    return { name, args: args || undefined };
  }

  // Bare identifier
  if (/^\w+(?:\.\w+)?$/.test(expr)) {
    return { name };
  }

  return null;
}

export async function scanMiddleware(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".js", ".mjs", ".cjs"],
  });

  const entries: MiddlewareEntry[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (!content.includes("app.use(")) continue;

    USE_PREFIX.lastIndex = 0;
    let prefixMatch;
    while ((prefixMatch = USE_PREFIX.exec(content)) !== null) {
      const openParenEnd = prefixMatch.index + prefixMatch[0].length;
      const extracted = extractUseArgs(content, openParenEnd);
      if (!extracted) continue;
      const argsRaw = extracted.args;
      USE_PREFIX.lastIndex = extracted.end;
      // Split on commas at depth 0 to get all args (some app.use calls chain multiple middlewares)
      const args: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of argsRaw) {
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (ch === "," && depth === 0) {
          args.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) args.push(cur.trim());

      if (args.length === 0) continue;

      // Skip route-mount style: app.use('/api', router)
      if (isRouteMount(args[0])) continue;

      for (const arg of args) {
        const extracted = extractMiddlewareName(arg);
        if (extracted) {
          entries.push({ ...extracted, sourceFile: file });
        }
      }
    }
  }

  if (entries.length === 0) return null;

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const key = `${e.name}(${e.args ?? ""})`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sections: string[] = [heading(1, "Middleware")];

  const items = unique.map((m) => {
    return m.args !== undefined ? `${m.name}(${m.args})` : m.name;
  });

  sections.push(joinSections(heading(2, "Global Middleware Chain"), bulletList(items)));

  return {
    filename: "middleware.md",
    content: sections.join("\n\n") + "\n",
  };
}
