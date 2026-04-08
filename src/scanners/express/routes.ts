import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "all"];

interface Route {
  method: string;
  path: string;
  handler: string;
  middlewares: string[];
  mountPrefix: string;
  sourceFile: string;
}

// Track Router() variables assigned to known names (e.g. `const router = express.Router()`).
// We regex-scan lines that call HTTP methods on these identifiers OR on `app`.
const ROUTER_IDENTIFIERS = /\b(app|router|api|[\w$]*Router)\b/;

function extractMountPrefix(content: string, routerVar: string): string | null {
  // Look for app.use('/prefix', routerVar)
  const regex = new RegExp(
    `\\.use\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*,\\s*${routerVar}\\b`,
    "g"
  );
  const match = regex.exec(content);
  return match ? match[1] : null;
}

// Scan a file's content for route registrations.
function parseRoutesInFile(filePath: string, content: string): Route[] {
  const routes: Route[] = [];

  // Match: <ident>.<method>('<path>', handler1, handler2, ...)
  // Note: we only catch single-line handler refs; complex handlers are shown as "<inline>"
  const routeRegex = new RegExp(
    `(\\w+)\\.(${HTTP_METHODS.join("|")})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*,\\s*([^)]*)\\)`,
    "g"
  );

  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const ident = match[1];
    const method = match[2].toUpperCase();
    const routePath = match[3];
    const argsRaw = match[4];

    if (!ROUTER_IDENTIFIERS.test(ident)) continue;

    // Parse handler chain — split on commas at depth 0
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

    // Last arg is the handler, preceding args are middlewares
    const handler = args[args.length - 1];
    const middlewares = args.slice(0, -1);

    // Normalize inline arrow functions / async fns
    const displayHandler = /^\s*(async\s*)?\(?.*=>/.test(handler) || handler.startsWith("function")
      ? "<inline>"
      : handler;

    routes.push({
      method,
      path: routePath,
      handler: displayHandler,
      middlewares,
      mountPrefix: "",
      sourceFile: filePath,
    });
  }

  return routes;
}

// Build a map: file path → mount prefix that was applied to its exported router
function buildMountMap(files: string[], rootDir: string): Map<string, string> {
  const mountMap = new Map<string, string>();

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // Match: app.use('/api', require('./routes/foo'))
    //        app.use('/api', fooRouter)  where fooRouter is imported from a file
    const useRegex = /\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)|(\w+))/g;
    let match;
    while ((match = useRegex.exec(content)) !== null) {
      const prefix = match[1];
      const requirePath = match[2];
      const importedIdent = match[3];

      if (requirePath) {
        // Resolve require('./routes/foo') → absolute path
        const resolved = resolveRequirePath(file, requirePath);
        if (resolved) mountMap.set(resolved, prefix);
      } else if (importedIdent) {
        // Look for import statement for this identifier and resolve its path
        const importRegex = new RegExp(
          `(?:import\\s+${importedIdent}\\s+from|import\\s*\\{[^}]*\\b${importedIdent}\\b[^}]*\\}\\s+from|const\\s+${importedIdent}\\s*=\\s*require\\s*\\()\\s*['"\`]([^'"\`]+)['"\`]`
        );
        const importMatch = content.match(importRegex);
        if (importMatch) {
          const resolved = resolveRequirePath(file, importMatch[1]);
          if (resolved) mountMap.set(resolved, prefix);
        }
      }
    }
  }

  return mountMap;
}

function resolveRequirePath(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) return null;
  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, importPath);
  const candidates = [
    base,
    base + ".ts", base + ".js", base + ".mjs", base + ".cjs",
    path.join(base, "index.ts"), path.join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function groupByResource(routes: Route[]): Record<string, Route[]> {
  const grouped: Record<string, Route[]> = {};
  for (const r of routes) {
    const full = (r.mountPrefix + r.path).replace(/\/+/g, "/");
    const parts = full.replace(/^\//, "").split("/");
    const resource = parts[0] || "Root";
    const key = resource.charAt(0).toUpperCase() + resource.slice(1);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...r, path: full });
  }
  return grouped;
}

export async function scanRoutes(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".js", ".mjs", ".cjs"],
  });

  if (files.length === 0) return null;

  // First pass: build mount prefix map
  const mountMap = buildMountMap(files, options.rootDir);

  // Second pass: parse routes
  const allRoutes: Route[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // Skip files that don't mention HTTP methods at all (fast filter)
    if (!/\.(get|post|put|patch|delete|head|options|all)\s*\(/.test(content)) continue;

    const routes = parseRoutesInFile(file, content);
    const mountPrefix = mountMap.get(file) ?? "";

    for (const r of routes) {
      r.mountPrefix = mountPrefix;
      allRoutes.push(r);
    }
  }

  if (allRoutes.length === 0) return null;

  // Build markdown
  const grouped = groupByResource(allRoutes);

  const sections: string[] = [heading(1, "Routes")];

  for (const [resource, routes] of Object.entries(grouped).sort()) {
    const items = routes.map((r) => {
      const parts = [`${r.method.padEnd(6)} ${r.path}`];
      if (r.middlewares.length > 0) {
        parts.push(`[${r.middlewares.join(", ")}]`);
      }
      parts.push(`→ ${r.handler}`);
      return parts.join("  ");
    });
    sections.push(joinSections(heading(2, resource), bulletList(items)));
  }

  return {
    filename: "routes.md",
    content: sections.join("\n\n") + "\n",
  };
}
