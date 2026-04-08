import { CrossStackScanner, ScanResult, ScanOptions } from "../types";
import { heading, joinSections, bulletList, bold } from "../../utils/markdown";

interface Endpoint {
  method: string;
  path: string;
  meta: string; // extra info (handler, body, response type)
}

// Parse endpoint bullets out of a scanner markdown doc.
// Format expected: `- GET    /path/here  ...extra...`
function parseEndpoints(md: string): Endpoint[] {
  const endpoints: Endpoint[] = [];
  const re = /^- (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)\s+(\S+)(.*)$/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    endpoints.push({
      method: m[1].toUpperCase(),
      path: m[2],
      meta: m[3].trim(),
    });
  }
  return endpoints;
}

// Normalize a URL path for comparison:
//  - collapse duplicate slashes
//  - strip trailing slash (except root)
//  - lowercase
//  - replace any :param / {param} with `:*` so `/users/:id` matches `/users/:userId`
function normalizePath(p: string): string {
  let n = p.replace(/\/+/g, "/").toLowerCase();
  if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
  n = n.replace(/:[a-z0-9_]+/g, ":*");
  n = n.replace(/\{[a-z0-9_]+\}/g, ":*");
  return n;
}

// When comparing mobile paths to backend paths, the mobile client may omit
// a common mount prefix like `/api` or `/api/v1`. Try a few variants.
function pathVariants(p: string, commonPrefixes: string[]): string[] {
  const norm = normalizePath(p);
  const variants = new Set<string>([norm]);
  for (const prefix of commonPrefixes) {
    const np = normalizePath(prefix);
    if (!norm.startsWith(np)) {
      variants.add(normalizePath(np + norm));
    }
  }
  return [...variants];
}

// Detect common backend mount prefixes from the routes list — any prefix
// that appears on every route.
function detectCommonPrefixes(endpoints: Endpoint[]): string[] {
  if (endpoints.length === 0) return [];
  const segments = endpoints.map((e) => e.path.split("/").filter(Boolean));
  const common: string[] = [];
  const first = segments[0];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    if (seg.startsWith(":") || seg.startsWith("{")) break;
    if (segments.every((s) => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  if (common.length === 0) return [];
  // Return prefix like "/api" and "/api/v1"
  const prefixes: string[] = [];
  for (let i = 1; i <= common.length; i++) {
    prefixes.push("/" + common.slice(0, i).join("/"));
  }
  return prefixes;
}

export const apiContractScanner: CrossStackScanner = {
  name: "api-contract",

  async scan(
    allResults: ScanResult[],
    frameworks: string[],
    _options: ScanOptions,
  ): Promise<ScanResult | null> {
    // Only meaningful when both sides are present
    if (!frameworks.includes("flutter") || !frameworks.includes("express")) {
      return null;
    }

    const apiClientDoc = allResults.find((r) => r.filename === "api-client.md");
    const routesDoc = allResults.find((r) => r.filename === "routes.md");

    if (!apiClientDoc || !routesDoc) return null;

    const mobileCalls = parseEndpoints(apiClientDoc.content);
    const backendRoutes = parseEndpoints(routesDoc.content);

    if (mobileCalls.length === 0 || backendRoutes.length === 0) return null;

    // Build backend index: "METHOD normalized_path" → original route
    const backendIndex = new Map<string, Endpoint>();
    for (const r of backendRoutes) {
      backendIndex.set(`${r.method} ${normalizePath(r.path)}`, r);
    }

    const commonPrefixes = detectCommonPrefixes(backendRoutes);

    // Matches and mismatches
    const matched: { mobile: Endpoint; backend: Endpoint }[] = [];
    const unmatchedMobile: Endpoint[] = [];
    const matchedBackendKeys = new Set<string>();

    for (const call of mobileCalls) {
      const variants = pathVariants(call.path, commonPrefixes);
      let hit: { key: string; backend: Endpoint } | null = null;

      for (const variant of variants) {
        const key = `${call.method} ${variant}`;
        const backend = backendIndex.get(key);
        if (backend) {
          hit = { key, backend };
          break;
        }
      }

      if (hit) {
        matched.push({ mobile: call, backend: hit.backend });
        matchedBackendKeys.add(hit.key);
      } else {
        unmatchedMobile.push(call);
      }
    }

    // Backend routes not called by mobile = orphans (from mobile's perspective)
    const unmatchedBackend: Endpoint[] = [];
    for (const r of backendRoutes) {
      const key = `${r.method} ${normalizePath(r.path)}`;
      if (!matchedBackendKeys.has(key)) {
        unmatchedBackend.push(r);
      }
    }

    // Build markdown
    const sections: string[] = [
      heading(1, "API Contract"),
      `${bold("Mobile calls")}: ${mobileCalls.length}  ·  ${bold("Backend routes")}: ${backendRoutes.length}  ·  ${bold("Matched")}: ${matched.length}`,
    ];

    if (commonPrefixes.length > 0) {
      sections.push(`${bold("Backend common prefix")}: \`${commonPrefixes[commonPrefixes.length - 1]}\``);
    }

    if (matched.length > 0) {
      const items = matched.map(
        (m) => `${m.mobile.method.padEnd(6)} ${m.mobile.path}  ↔  ${m.backend.path}`
      );
      sections.push(joinSections(heading(2, "Matched Endpoints"), bulletList(items)));
    }

    if (unmatchedMobile.length > 0) {
      const items = unmatchedMobile.map(
        (e) => `${e.method.padEnd(6)} ${e.path}  — no matching backend route`
      );
      sections.push(joinSections(heading(2, "Mobile Calls Without Backend Match"), bulletList(items)));
    }

    if (unmatchedBackend.length > 0) {
      const items = unmatchedBackend.map(
        (e) => `${e.method.padEnd(6)} ${e.path}  — not called from mobile`
      );
      sections.push(joinSections(heading(2, "Unused Backend Routes (from mobile)"), bulletList(items)));
    }

    return {
      filename: "api-contract.md",
      content: sections.join("\n\n") + "\n",
    };
  },
};
