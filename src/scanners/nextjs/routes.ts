import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Convert an `app/` or `pages/` directory path to a Next.js route.
// Examples:
//   app/page.tsx                       → /
//   app/about/page.tsx                 → /about
//   app/(marketing)/about/page.tsx     → /about            (route group stripped)
//   app/blog/[slug]/page.tsx           → /blog/:slug
//   app/shop/[...slug]/page.tsx        → /shop/:slug*
//   app/shop/[[...slug]]/page.tsx      → /shop/:slug?
//   app/@modal/page.tsx                → /                  (parallel route slot stripped)
//   pages/blog/[slug].tsx              → /blog/:slug
//   pages/api/users.ts                 → /api/users
function appRouteFromRelDir(relDir: string): string {
  const parts = relDir.split(/[\\/]/).filter(Boolean);
  const out: string[] = [];
  for (const seg of parts) {
    if (!seg) continue;
    // Route groups: (marketing)
    if (seg.startsWith("(") && seg.endsWith(")")) continue;
    // Parallel route slots: @modal
    if (seg.startsWith("@")) continue;
    // Optional catch-all: [[...slug]]
    let m = seg.match(/^\[\[\.\.\.(\w+)\]\]$/);
    if (m) { out.push(`:${m[1]}?`); continue; }
    // Catch-all: [...slug]
    m = seg.match(/^\[\.\.\.(\w+)\]$/);
    if (m) { out.push(`:${m[1]}*`); continue; }
    // Dynamic: [slug]
    m = seg.match(/^\[(\w+)\]$/);
    if (m) { out.push(`:${m[1]}`); continue; }
    out.push(seg);
  }
  const route = "/" + out.join("/");
  return route === "/" ? "/" : route.replace(/\/+$/, "");
}

function pagesRouteFromRelFile(relFile: string): string {
  // Strip extension first
  const noExt = relFile.replace(/\.(t|j)sx?$/, "");
  const parts = noExt.split(/[\\/]/).filter(Boolean);
  const out: string[] = [];
  for (let seg of parts) {
    // index → empty (root of dir)
    if (seg === "index") continue;
    let m = seg.match(/^\[\[\.\.\.(\w+)\]\]$/);
    if (m) { out.push(`:${m[1]}?`); continue; }
    m = seg.match(/^\[\.\.\.(\w+)\]$/);
    if (m) { out.push(`:${m[1]}*`); continue; }
    m = seg.match(/^\[(\w+)\]$/);
    if (m) { out.push(`:${m[1]}`); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}

function findHttpMethodExports(content: string): string[] {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const found: string[] = [];
  for (const m of methods) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\s*=`);
    if (re.test(content)) found.push(m);
  }
  return found;
}

interface AppRoute {
  route: string;
  kind: "page" | "api";
  methods?: string[];
  source: string;
}

interface PagesRoute {
  route: string;
  kind: "page" | "api";
  source: string;
}

function walkAppDir(appDir: string, baseDir: string, out: AppRoute[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(appDir, entry.name);
    if (entry.isDirectory()) {
      // Skip private folders (_components etc.)
      if (entry.name.startsWith("_")) continue;
      walkAppDir(full, baseDir, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const name = entry.name;
    const relDir = path.relative(baseDir, appDir);
    if (/^page\.(t|j)sx?$/.test(name)) {
      out.push({
        route: appRouteFromRelDir(relDir),
        kind: "page",
        source: path.relative(baseDir, full).replace(/\\/g, "/"),
      });
    } else if (/^route\.(t|j)s$/.test(name)) {
      const content = safeRead(full);
      out.push({
        route: appRouteFromRelDir(relDir),
        kind: "api",
        methods: content ? findHttpMethodExports(content) : [],
        source: path.relative(baseDir, full).replace(/\\/g, "/"),
      });
    }
  }
}

function walkPagesDir(pagesDir: string, baseDir: string, out: PagesRoute[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pagesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(pagesDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      walkPagesDir(full, baseDir, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(t|j)sx?$/.test(entry.name)) continue;
    // Skip Next.js special files
    if (/^_(app|document|error)\./.test(entry.name)) continue;
    const rel = path.relative(baseDir, full);
    const isApi = rel.split(/[\\/]/)[0] === "api";
    out.push({
      route: pagesRouteFromRelFile(rel),
      kind: isApi ? "api" : "page",
      source: rel.replace(/\\/g, "/"),
    });
  }
}

function safeRead(p: string): string | null {
  try { return fs.readFileSync(p, "utf-8"); } catch { return null; }
}

// Locate the app/ and pages/ directories. Next.js supports both at root or under src/.
function findRouterDirs(rootDir: string): { appDir: string | null; pagesDir: string | null; baseLabel: string } {
  const candidates = [
    { app: path.join(rootDir, "app"), pages: path.join(rootDir, "pages"), label: "" },
    { app: path.join(rootDir, "src", "app"), pages: path.join(rootDir, "src", "pages"), label: "src/" },
  ];
  let appDir: string | null = null;
  let pagesDir: string | null = null;
  let baseLabel = "";
  for (const c of candidates) {
    if (!appDir && fs.existsSync(c.app) && fs.statSync(c.app).isDirectory()) {
      appDir = c.app;
      baseLabel = c.label;
    }
    if (!pagesDir && fs.existsSync(c.pages) && fs.statSync(c.pages).isDirectory()) {
      pagesDir = c.pages;
      if (!baseLabel) baseLabel = c.label;
    }
  }
  return { appDir, pagesDir, baseLabel };
}

export async function scanRoutes(options: ScanOptions): Promise<ScanResult | null> {
  const { appDir, pagesDir, baseLabel } = findRouterDirs(options.rootDir);
  if (!appDir && !pagesDir) return null;

  const appRoutes: AppRoute[] = [];
  if (appDir) walkAppDir(appDir, appDir, appRoutes);

  const pagesRoutes: PagesRoute[] = [];
  if (pagesDir) walkPagesDir(pagesDir, pagesDir, pagesRoutes);

  if (appRoutes.length === 0 && pagesRoutes.length === 0) return null;

  const sections: string[] = [heading(1, "Routes")];

  if (appRoutes.length > 0) {
    sections.push(heading(2, `App Router (\`${baseLabel}app/\`)`));

    const pages = appRoutes.filter((r) => r.kind === "page").sort((a, b) => a.route.localeCompare(b.route));
    const apis = appRoutes.filter((r) => r.kind === "api").sort((a, b) => a.route.localeCompare(b.route));

    if (pages.length > 0) {
      sections.push(joinSections(
        heading(3, "Pages"),
        bulletList(pages.map((r) => `${r.route}  →  ${r.source}`)),
      ));
    }
    if (apis.length > 0) {
      sections.push(joinSections(
        heading(3, "Route Handlers"),
        bulletList(apis.map((r) => {
          const methods = r.methods && r.methods.length > 0 ? `[${r.methods.join(", ")}]` : "[?]";
          return `${methods}  ${r.route}  →  ${r.source}`;
        })),
      ));
    }
  }

  if (pagesRoutes.length > 0) {
    sections.push(heading(2, `Pages Router (\`${baseLabel}pages/\`)`));

    const pages = pagesRoutes.filter((r) => r.kind === "page").sort((a, b) => a.route.localeCompare(b.route));
    const apis = pagesRoutes.filter((r) => r.kind === "api").sort((a, b) => a.route.localeCompare(b.route));

    if (pages.length > 0) {
      sections.push(joinSections(
        heading(3, "Pages"),
        bulletList(pages.map((r) => `${r.route}  →  ${r.source}`)),
      ));
    }
    if (apis.length > 0) {
      sections.push(joinSections(
        heading(3, "API Routes"),
        bulletList(apis.map((r) => `${r.route}  →  ${r.source}`)),
      ));
    }
  }

  return {
    filename: "routes.md",
    content: sections.join("\n\n") + "\n",
  };
}
