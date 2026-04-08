import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

interface Route {
  method: string;
  path: string;
  source: string;
  framework: "bun-serve" | "hono" | "elysia";
}

// Match Bun.serve({ routes: { ... } }) — Bun 1.2+ native routing.
// Inside the routes object: "/path": handler  OR  "/path": { GET, POST, ... }
function findBunServeRoutes(content: string, relFile: string): Route[] {
  const out: Route[] = [];
  const idx = content.search(/Bun\.serve\s*\(/);
  if (idx === -1) return out;

  // Find a `routes:` field inside the call
  const routesMatch = content.slice(idx).match(/routes\s*:\s*\{/);
  if (!routesMatch || routesMatch.index === undefined) {
    // Single fetch handler form — note as catch-all
    if (/fetch\s*[:(]/.test(content.slice(idx, idx + 200))) {
      out.push({ method: "ANY", path: "/*", source: relFile, framework: "bun-serve" });
    }
    return out;
  }

  const start = idx + routesMatch.index + routesMatch[0].length;
  // Walk balanced braces to find end of routes object
  let depth = 1;
  let i = start;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) break;
    i++;
  }
  const routesBlock = content.slice(start, i);

  // Walk the routes block character-by-character. At each top-level (depth 0
  // relative to the routes object body) string key followed by ":", capture
  // the value — either a balanced { ... } object or a single expression up to
  // the next top-level comma.
  let j = 0;
  while (j < routesBlock.length) {
    // Skip whitespace and commas
    while (j < routesBlock.length && /[\s,]/.test(routesBlock[j])) j++;
    if (j >= routesBlock.length) break;
    // Expect a quoted key
    const quote = routesBlock[j];
    if (quote !== '"' && quote !== "'" && quote !== "`") { j++; continue; }
    const keyStart = j + 1;
    let k = keyStart;
    while (k < routesBlock.length && routesBlock[k] !== quote) k++;
    if (k >= routesBlock.length) break;
    const routePath = routesBlock.slice(keyStart, k);
    j = k + 1;
    // Skip whitespace + colon
    while (j < routesBlock.length && /\s/.test(routesBlock[j])) j++;
    if (routesBlock[j] !== ":") continue;
    j++;
    while (j < routesBlock.length && /\s/.test(routesBlock[j])) j++;

    // Capture value
    let value: string;
    if (routesBlock[j] === "{") {
      // Balanced brace walk
      let d = 1;
      const vStart = j;
      j++;
      while (j < routesBlock.length && d > 0) {
        const c = routesBlock[j];
        if (c === "{") d++;
        else if (c === "}") d--;
        if (d === 0) { j++; break; }
        j++;
      }
      value = routesBlock.slice(vStart, j);
    } else {
      // Read until top-level comma or end
      let d = 0;
      const vStart = j;
      while (j < routesBlock.length) {
        const c = routesBlock[j];
        if (c === "(" || c === "[" || c === "{") d++;
        else if (c === ")" || c === "]" || c === "}") d--;
        else if (c === "," && d === 0) break;
        j++;
      }
      value = routesBlock.slice(vStart, j).trim();
    }

    if (!routePath.startsWith("/")) continue;
    if (value.startsWith("{")) {
      // Find HTTP method keys at the top level of this object
      const methodRe = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*:/g;
      const methods = new Set<string>();
      let mm;
      while ((mm = methodRe.exec(value)) !== null) methods.add(mm[1]);
      for (const method of methods) {
        out.push({ method, path: routePath, source: relFile, framework: "bun-serve" });
      }
    } else if (value.length > 0) {
      out.push({ method: "ANY", path: routePath, source: relFile, framework: "bun-serve" });
    }
  }
  return out;
}

// Match Hono / Elysia: <ident>.<method>('/path', handler...)
function findHonoElysiaRoutes(content: string, relFile: string, framework: "hono" | "elysia"): Route[] {
  const out: Route[] = [];
  // Match `.method('/path'` — works for both `app.get(...)` and chained
  // `new Elysia().get(...).post(...)`. We don't require an identifier before
  // the dot since chained calls have `)` or whitespace there.
  const re = /\.(get|post|put|patch|delete|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  const seen = new Set<string>();
  while ((m = re.exec(content)) !== null) {
    const method = m[1].toUpperCase();
    const routePath = m[2];
    const key = `${method} ${routePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method, path: routePath, source: relFile, framework });
  }
  return out;
}

function detectFramework(content: string): "hono" | "elysia" | null {
  if (/from\s+['"`]hono['"`]|require\(['"`]hono['"`]\)|new\s+Hono\s*\(/.test(content)) return "hono";
  if (/from\s+['"`]elysia['"`]|require\(['"`]elysia['"`]\)|new\s+Elysia\s*\(/.test(content)) return "elysia";
  return null;
}

export async function scanRoutes(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  });

  const allRoutes: Route[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const rel = path.relative(options.rootDir, file).replace(/\\/g, "/");

    if (/Bun\.serve\s*\(/.test(content)) {
      allRoutes.push(...findBunServeRoutes(content, rel));
    }
    const fw = detectFramework(content);
    if (fw) {
      allRoutes.push(...findHonoElysiaRoutes(content, rel, fw));
    }
  }

  if (allRoutes.length === 0) return null;

  // Group by framework
  const byFw: Record<string, Route[]> = {};
  for (const r of allRoutes) {
    if (!byFw[r.framework]) byFw[r.framework] = [];
    byFw[r.framework].push(r);
  }

  const sections: string[] = [heading(1, "Routes")];
  const labels: Record<string, string> = {
    "bun-serve": "Bun.serve()",
    "hono": "Hono",
    "elysia": "Elysia",
  };

  for (const fw of Object.keys(byFw).sort()) {
    const routes = byFw[fw].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    const items = routes.map((r) => `${r.method.padEnd(6)} ${r.path}  →  ${r.source}`);
    sections.push(joinSections(heading(2, labels[fw] ?? fw), bulletList(items)));
  }

  return {
    filename: "routes.md",
    content: sections.join("\n\n") + "\n",
  };
}
