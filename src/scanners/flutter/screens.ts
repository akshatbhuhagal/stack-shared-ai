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

function parseGoRouterRoutes(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Match GoRoute definitions
  const goRouteRegex = /GoRoute\s*\(\s*(?:name:\s*['"][^'"]*['"]\s*,\s*)?path:\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = goRouteRegex.exec(content)) !== null) {
    const routePath = match[1];
    // Extract this GoRoute's block (up to the next GoRoute or a limited window)
    const blockStart = match.index;
    const nextGoRoute = content.indexOf("GoRoute", blockStart + 10);
    const blockEnd = nextGoRoute > blockStart ? nextGoRoute : blockStart + 500;
    const afterMatch = content.substring(blockStart, blockEnd);

    let screen = "Unknown";
    const builderMatch = afterMatch.match(/(?:builder|pageBuilder):[^>]*?>\s*(?:const\s+)?(\w+)/);
    if (builderMatch) {
      screen = builderMatch[1];
    }

    // Check for params
    const paramMatches = routePath.match(/:(\w+)/g);
    const params = paramMatches ? paramMatches.map((p) => p.slice(1)).join(", ") : undefined;

    // Check for redirect/guard only within this route's block
    let guard: string | undefined;
    if (afterMatch.includes("redirect:")) {
      const redirectMatch = afterMatch.match(/redirect:[^}]*?(auth|login|guard)/i);
      guard = redirectMatch ? "auth-required" : "has-redirect";
    }

    routes.push({ path: routePath, screen, params, guard });
  }

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
