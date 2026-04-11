import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses, DartClass } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const SCREEN_DIRS = ["screens", "screen", "pages", "page", "views", "view"];
const SCREEN_SUFFIXES = ["Screen", "Page", "View"];

type RouterType = "go_router" | "auto_route" | "manual" | "none";

function isScreenDir(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => SCREEN_DIRS.includes(p));
}

function isScreenClass(cls: DartClass, filePath: string): boolean {
  if (!cls.superclass) return false;
  const isWidget = cls.superclass.includes("StatelessWidget") || cls.superclass.includes("StatefulWidget");
  if (!isWidget) return false;
  if (isScreenDir(filePath)) return true;
  return SCREEN_SUFFIXES.some((suffix) => cls.name.endsWith(suffix));
}

function detectRouter(rootDir: string): RouterType {
  const pubspecPath = path.join(rootDir, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return "none";
  try {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    const pubspec = parseYaml(content) as Record<string, unknown>;
    const deps = { ...(pubspec.dependencies as Record<string, unknown> ?? {}), ...(pubspec.dev_dependencies as Record<string, unknown> ?? {}) };
    if (deps.go_router) return "go_router";
    if (deps.auto_route) return "auto_route";
    return "manual";
  } catch {
    return "manual";
  }
}

interface RouteInfo {
  path: string;
  screen: string;
  params?: string;
  guard?: string;
  children?: RouteInfo[];
}

// Find the matching closing character for the opening char at position `start`.
// Supports (), [], {}. Returns the index of the matching close, or -1 if unbalanced.
function findMatchingClose(content: string, start: number): number {
  const open = content[start];
  const closeMap: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const close = closeMap[open];
  if (!close) return -1;

  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < content.length; i++) {
    const c = content[i];
    // Skip inside string literals
    if (inString) {
      if (c === "\\") { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") { inString = c; continue; }
    if (c === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Extract the top-level block body for `Keyword(...)` starting at position `start`.
// Returns the body (inside the parens) and the index just past the closing paren.
function extractCallBody(content: string, start: number): { body: string; end: number } | null {
  const openParen = content.indexOf("(", start);
  if (openParen === -1) return null;
  const close = findMatchingClose(content, openParen);
  if (close === -1) return null;
  return { body: content.slice(openParen + 1, close), end: close + 1 };
}

// Recursively parse GoRouter-style route definitions. Handles:
//   GoRoute(path: '/x', builder: ..., routes: [GoRoute(...)])
//   ShellRoute(builder: (_, __, child) => ..., routes: [GoRoute(...)])
//   StatefulShellRoute.indexedStack(branches: [StatefulShellBranch(routes: [...])])
// Children inherit their parent's path prefix so nested routes report absolute paths.
function parseGoRouterRoutes(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function joinPath(parent: string, child: string): string {
    if (child.startsWith("/")) return child; // absolute
    if (!parent || parent === "/") return `/${child.replace(/^\//, "")}`;
    return `${parent.replace(/\/$/, "")}/${child}`;
  }

  // Parse the contents of a routes: [...] list, starting at `body` (already
  // unwrapped). Adds results to `routes`. `parentPath` is the prefix inherited
  // from enclosing shells.
  function parseRouteList(body: string, parentPath: string, shellContext?: string): void {
    // Scan for GoRoute / ShellRoute / StatefulShellRoute / StatefulShellBranch calls
    const keywordRe = /\b(GoRoute|ShellRoute|StatefulShellRoute(?:\.\w+)?|StatefulShellBranch)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = keywordRe.exec(body)) !== null) {
      const keyword = m[1];
      const blockStart = m.index + m[0].length - 1; // at '('
      const close = findMatchingClose(body, blockStart);
      if (close === -1) break;
      const block = body.slice(blockStart + 1, close);

      if (keyword === "GoRoute") {
        const pathMatch = block.match(/\bpath\s*:\s*['"]([^'"]+)['"]/);
        const routePath = pathMatch ? pathMatch[1] : "?";
        const absolutePath = joinPath(parentPath, routePath);

        // Screen builder — find either `builder:` or `pageBuilder:` and read the
        // first identifier that follows the fat-arrow (or call target).
        let screen = "Unknown";
        const builderMatch = block.match(/(?:builder|pageBuilder)\s*:[^}]*?=>\s*(?:const\s+)?(\w+)/);
        if (builderMatch) screen = builderMatch[1];

        const paramMatches = absolutePath.match(/:(\w+)/g);
        const params = paramMatches ? paramMatches.map((p) => p.slice(1)).join(", ") : undefined;

        let guard: string | undefined;
        if (shellContext) guard = shellContext;
        if (/\bredirect\s*:/.test(block)) {
          guard = guard ? `${guard}, has-redirect` : "has-redirect";
        }

        routes.push({ path: absolutePath, screen, params, guard });

        // Recurse into nested routes: [ ... ]
        const nested = findRoutesArray(block);
        if (nested) parseRouteList(nested, absolutePath, shellContext);

        // Jump lastIndex past this block so we don't re-enter it
        keywordRe.lastIndex = close + 1;
      } else if (keyword === "ShellRoute" || keyword.startsWith("StatefulShellRoute")) {
        // Shell doesn't consume a path; children carry the parent path prefix.
        const label = keyword === "ShellRoute" ? "shell" : "stateful-shell";
        const nestedRoutes = findRoutesArray(block);
        if (nestedRoutes) parseRouteList(nestedRoutes, parentPath, label);
        // StatefulShellRoute may use `branches: [...]` instead
        const branches = findNamedArray(block, "branches");
        if (branches) parseRouteList(branches, parentPath, label);
        keywordRe.lastIndex = close + 1;
      } else if (keyword === "StatefulShellBranch") {
        // Each branch has its own routes: [...]
        const branchRoutes = findRoutesArray(block);
        if (branchRoutes) parseRouteList(branchRoutes, parentPath, shellContext ?? "branch");
        keywordRe.lastIndex = close + 1;
      }
    }
  }

  // Find the `routes: [ ... ]` array inside a block and return its inner body.
  function findRoutesArray(block: string): string | null {
    return findNamedArray(block, "routes");
  }

  function findNamedArray(block: string, name: string): string | null {
    const re = new RegExp(`\\b${name}\\s*:\\s*(?:<[^>]+>)?\\s*\\[`, "g");
    const m = re.exec(block);
    if (!m) return null;
    const openBracket = m.index + m[0].length - 1;
    const close = findMatchingClose(block, openBracket);
    if (close === -1) return null;
    return block.slice(openBracket + 1, close);
  }

  parseRouteList(content, "");
  return routes;
}

function parseAutoRouteRoutes(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Match AutoRoute entries inside router config
  // Patterns: AutoRoute(page: HomeRoute.page, path: '/home', initial: true, guards: [AuthGuard])
  //           AutoRoute(page: HomeRoute.page)
  const autoRouteRegex = /(?:AutoRoute|AdaptiveRoute|CustomRoute|MaterialRoute|CupertinoRoute|RedirectRoute)\s*\(/g;
  let match;

  while ((match = autoRouteRegex.exec(content)) !== null) {
    // Extract the full parenthesized block for this entry
    const blockStart = match.index + match[0].length;
    let depth = 1;
    let blockEnd = blockStart;
    for (let i = blockStart; i < content.length && depth > 0; i++) {
      if (content[i] === "(") depth++;
      else if (content[i] === ")") depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
    const block = content.substring(blockStart, blockEnd);

    // Extract page: XxxRoute.page → screen = Xxx
    const pageMatch = block.match(/page:\s*(\w+)\.page/);
    if (!pageMatch) continue;
    const routeName = pageMatch[1];
    const screen = routeName.replace(/Route$/, "");

    // Extract path: '/foo/:id' (optional — AutoRoute can auto-generate)
    const pathMatch = block.match(/path:\s*['"]([^'"]+)['"]/);
    const routePath = pathMatch ? pathMatch[1] : `/${screen.toLowerCase()}`;

    // Detect initial route
    const isInitial = /initial:\s*true/.test(block);

    // Detect guards
    const guardsMatch = block.match(/guards:\s*\[([^\]]+)\]/);
    const guard = guardsMatch ? guardsMatch[1].trim().split(",")[0].trim() : undefined;

    // Extract params from path
    const paramMatches = routePath.match(/:(\w+)/g);
    const params = paramMatches ? paramMatches.map((p) => p.slice(1)).join(", ") : undefined;

    routes.push({
      path: isInitial ? `${routePath} (initial)` : routePath,
      screen,
      params,
      guard,
    });
  }

  return routes;
}

// Parse @RoutePage() annotated screen classes — AutoRoute's codegen marker.
// Any widget annotated with @RoutePage is a routable screen.
function parseRoutePageAnnotations(content: string, filePath: string): string[] {
  const screens: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!/@RoutePage\s*\(/.test(lines[i])) continue;
    // Look for the class declaration within the next few lines
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const classMatch = lines[j].match(/class\s+(\w+)/);
      if (classMatch) {
        screens.push(classMatch[1]);
        break;
      }
    }
  }

  return screens;
}

function parseManualNavigation(content: string, filePath: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Navigator.push with MaterialPageRoute
  const pushRegex = /Navigator\.(?:push|pushReplacement)\w*\s*\([^)]*?(?:MaterialPageRoute|CupertinoPageRoute)\s*\([^)]*?builder:[^)]*?(\w+Screen|\w+Page|\w+View)\s*\(/g;
  let match;

  while ((match = pushRegex.exec(content)) !== null) {
    routes.push({ path: "(push)", screen: match[1] });
  }

  // Navigator.pushNamed
  const namedRegex = /Navigator\.pushNamed\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
  while ((match = namedRegex.exec(content)) !== null) {
    routes.push({ path: match[1], screen: "Unknown" });
  }

  return routes;
}

export async function scanScreens(options: ScanOptions): Promise<ScanResult | null> {
  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  });

  const routerType = detectRouter(options.rootDir);

  // Find all screen classes
  interface ScreenInfo {
    name: string;
    relativePath: string;
  }

  const screens: ScreenInfo[] = [];

  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (filePath.endsWith(".g.dart") || filePath.endsWith(".freezed.dart")) continue;

    const classes = getDartClasses(filePath, content);
    const relativePath = path.relative(options.rootDir, filePath).replace(/\\/g, "/");

    // Collect @RoutePage-annotated classes (AutoRoute)
    const routePageScreens = routerType === "auto_route"
      ? new Set(parseRoutePageAnnotations(content, filePath))
      : new Set<string>();

    for (const cls of classes) {
      if (isScreenClass(cls, filePath) || routePageScreens.has(cls.name)) {
        screens.push({ name: cls.name, relativePath });
      }
    }
  }

  // Parse routes
  let routes: RouteInfo[] = [];

  if (routerType === "go_router" || routerType === "auto_route") {
    // Scan all dart files for router config
    for (const filePath of dartFiles) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      if (routerType === "go_router" && content.includes("GoRoute")) {
        routes.push(...parseGoRouterRoutes(content));
      } else if (routerType === "auto_route" && content.includes("AutoRoute(")) {
        routes.push(...parseAutoRouteRoutes(content));
      }
    }
  } else if (routerType === "manual") {
    for (const filePath of dartFiles) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      if (content.includes("Navigator.")) {
        routes.push(...parseManualNavigation(content, filePath));
      }
    }
  }

  // Deduplicate routes by path+screen
  {
    const seen = new Set<string>();
    routes = routes.filter((r) => {
      const key = `${r.path}|${r.screen}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Detect bottom nav / tab bar usage
  const tabScreens: string[] = [];
  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (content.includes("BottomNavigationBar") || content.includes("NavigationBar") || content.includes("TabBar")) {
      // Try to extract screen references near the nav bar
      const navScreenRegex = /(?:const\s+)?(\w+(?:Screen|Page|View))\s*\(/g;
      let match;
      while ((match = navScreenRegex.exec(content)) !== null) {
        if (!tabScreens.includes(match[1])) {
          tabScreens.push(match[1]);
        }
      }
    }
  }

  // Detect dialogs/modals
  const dialogs: { name: string; shownFrom: string }[] = [];
  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const dialogRegex = /showDialog[^;]*?(?:builder:[^)]*?(?:const\s+)?(\w+Dialog|\w+BottomSheet)\s*\()/g;
    let match;
    while ((match = dialogRegex.exec(content)) !== null) {
      const callerClasses = getDartClasses(filePath, content);
      const shownFrom = callerClasses.length > 0 ? callerClasses[0].name : path.basename(filePath, ".dart");
      dialogs.push({ name: match[1], shownFrom });
    }
  }

  if (screens.length === 0 && routes.length === 0) return null;

  // Build markdown
  const sections: string[] = [heading(1, "Screens")];

  const routerLabel = routerType === "go_router" ? "GoRouter"
    : routerType === "auto_route" ? "AutoRoute"
    : routerType === "manual" ? "Manual Navigation"
    : "Unknown";

  sections.push(heading(2, `Navigation: ${routerLabel}`));

  // Tab navigation
  if (tabScreens.length > 0) {
    const tabItems = tabScreens.map((s) => {
      const route = routes.find((r) => r.screen === s);
      return route ? `\`${route.path}\` → ${s}` : s;
    });
    sections.push(joinSections(heading(3, "Tab Navigation"), bulletList(tabItems)));
  }

  // Stack navigation (routes)
  if (routes.length > 0) {
    const stackRoutes = routes.filter((r) => !tabScreens.includes(r.screen));
    if (stackRoutes.length > 0) {
      const routeItems = stackRoutes.map((r) => {
        let line = `\`${r.path}\` → ${r.screen}`;
        if (r.params) line += ` (params: ${r.params})`;
        if (r.guard) line += ` [${r.guard}]`;
        return line;
      });
      sections.push(joinSections(heading(3, "Stack Navigation"), bulletList(routeItems)));
    }
  }

  // Screens without routes (fallback listing)
  const routedScreenNames = new Set(routes.map((r) => r.screen));
  const unroutedScreens = screens.filter((s) => !routedScreenNames.has(s.name) && !tabScreens.includes(s.name));
  if (unroutedScreens.length > 0) {
    const items = unroutedScreens.map((s) => `${s.name} (${s.relativePath})`);
    sections.push(joinSections(heading(3, "Other Screens"), bulletList(items)));
  }

  // Dialogs / Modals
  if (dialogs.length > 0) {
    const dialogItems = dialogs.map((d) => `${d.name} (shown from ${d.shownFrom})`);
    sections.push(joinSections(heading(3, "Modals / Dialogs"), bulletList(dialogItems)));
  }

  return {
    filename: "screens.md",
    content: sections.join("\n\n") + "\n",
  };
}
