import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses, DartClass } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

type HttpPackage = "dio" | "http" | "retrofit" | "chopper" | "unknown";

function detectHttpPackage(rootDir: string): HttpPackage {
  const pubspecPath = path.join(rootDir, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return "unknown";
  try {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    const pubspec = parseYaml(content) as Record<string, unknown>;
    const deps = { ...(pubspec.dependencies as Record<string, unknown> ?? {}), ...(pubspec.dev_dependencies as Record<string, unknown> ?? {}) };
    if (deps.retrofit) return "retrofit";
    if (deps.chopper) return "chopper";
    if (deps.dio) return "dio";
    if (deps.http) return "http";
    return "unknown";
  } catch {
    return "unknown";
  }
}

interface ApiEndpoint {
  method: string;
  path: string;
  responseType?: string;
  bodyType?: string;
  queryParams?: string[];
  source: string; // file where it was found
}

function parseDioCalls(content: string, filePath: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // Match dio.get('/path'), dio.post('/path', data: ...) etc.
  // Match both plain strings and string interpolation: '/path', '/path/$var', '/path/${expr}'
  const dioRegex = /(?:dio|_dio|client|_client|api|_api)\.(get|post|put|patch|delete|head)\s*(?:<([^>]+)>\s*)?\(\s*['"`]([^'"`\n]+)['"`]/gi;
  let match;

  while ((match = dioRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const responseType = match[2] || undefined;
    // Normalize Dart string interpolation to :param style
    const urlPath = match[3]
      .replace(/\$\{([^}]+)\}/g, ":$1")
      .replace(/\$(\w+)/g, ":$1");

    // Limit search to this call's scope (up to the semicolon ending the statement)
    const stmtEnd = content.indexOf(";", match.index);
    const afterMatch = content.substring(match.index, stmtEnd > match.index ? stmtEnd + 1 : match.index + 200);
    let bodyType: string | undefined;
    const dataMatch = afterMatch.match(/data:\s*(\w+)(?:\.toJson\(\))?/);
    if (dataMatch) bodyType = dataMatch[1];

    // Try to find query parameters
    const queryParams: string[] = [];
    const queryMatch = afterMatch.match(/queryParameters:\s*\{([^}]+)\}/);
    if (queryMatch) {
      const params = queryMatch[1].match(/['"](\w+)['"]/g);
      if (params) queryParams.push(...params.map((p) => p.replace(/['"]/g, "")));
    }

    endpoints.push({
      method,
      path: urlPath,
      responseType,
      bodyType,
      queryParams: queryParams.length > 0 ? queryParams : undefined,
      source: filePath,
    });
  }

  return endpoints;
}

function parseRetrofitMethods(classes: DartClass[], content: string, filePath: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // Match Retrofit annotations: @GET('/path'), @POST('/path'), etc.
  const annotationRegex = /@(GET|POST|PUT|PATCH|DELETE|HEAD)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    annotationRegex.lastIndex = 0;
    const annoMatch = annotationRegex.exec(line);
    if (!annoMatch) continue;

    const method = annoMatch[1];
    const urlPath = annoMatch[2];

    // Look at next non-empty line for the method signature
    let returnType: string | undefined;
    let bodyType: string | undefined;
    const queryParams: string[] = [];

    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const nextLine = lines[j].trim();
      if (!nextLine || nextLine.startsWith("@")) continue;

      // Extract return type: Future<ResponseType>
      const retMatch = nextLine.match(/Future<([^>]+)>/);
      if (retMatch) returnType = retMatch[1];

      // Extract body param: @Body() Type name
      const bodyMatch = nextLine.match(/@Body\(\)\s+(\w+)/);
      if (bodyMatch) bodyType = bodyMatch[1];

      // Extract query params: @Query('name')
      const queryRegex = /@Query\(['"](\w+)['"]\)/g;
      let qm;
      while ((qm = queryRegex.exec(nextLine)) !== null) {
        queryParams.push(qm[1]);
      }
      break;
    }

    endpoints.push({
      method,
      path: urlPath,
      responseType: returnType,
      bodyType,
      queryParams: queryParams.length > 0 ? queryParams : undefined,
      source: filePath,
    });
  }

  return endpoints;
}

function parseHttpPackageCalls(content: string, filePath: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // Match http.get(Uri.parse('...')), http.post(Uri.parse('...')) etc.
  const httpRegex = /http\.(get|post|put|patch|delete|head)\s*\(\s*Uri\.parse\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;

  while ((match = httpRegex.exec(content)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: match[2],
      source: filePath,
    });
  }

  return endpoints;
}

function parseChopperMethods(classes: DartClass[], content: string, filePath: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // Match Chopper annotations: @Get(path: '/path'), @Post(path: '/path')
  const annotationRegex = /@(Get|Post|Put|Patch|Delete)\s*\(\s*path:\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = annotationRegex.exec(content)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: match[2],
      source: filePath,
    });
  }

  return endpoints;
}

function extractBaseUrl(content: string): string | null {
  // Prefer BaseOptions(baseUrl: '...') since it's the canonical Dio setup
  const baseOptionsMatch = content.match(/BaseOptions\s*\([^)]*?baseUrl\s*:\s*['"]([^'"]+)['"]/);
  if (baseOptionsMatch) return baseOptionsMatch[1];

  // Plain `baseUrl: 'x'` or `baseUrl = 'x'` or `const baseUrl = 'x'`
  const baseUrlRegex = /baseUrl\s*[:=]\s*['"]([^'"]+)['"]/i;
  const match = content.match(baseUrlRegex);
  return match ? match[1] : null;
}

interface InterceptorInfo {
  name: string;
  file: string;
  hints: string[]; // short tags: "auth", "logging", "retry", "error"
}

// Detect Dio interceptors. Two forms exist:
//   1. A class that extends Interceptor / InterceptorsWrapper / QueuedInterceptor
//   2. An instance added via `dio.interceptors.add(Foo())`
// We surface (1) — it's what users actually read when looking for "where is auth
// header added?" or "where does retry live?".
function parseInterceptors(classes: DartClass[], content: string, filePath: string): InterceptorInfo[] {
  const out: InterceptorInfo[] = [];

  for (const cls of classes) {
    if (!cls.superclass) continue;
    const base = cls.superclass;
    const isInterceptor =
      base.includes("Interceptor") ||
      base.includes("InterceptorsWrapper") ||
      base.includes("QueuedInterceptor");
    if (!isInterceptor) continue;

    // Heuristic tags based on class + method names
    const hints: string[] = [];
    const classText = (cls.name + " " + cls.methods.map((m) => m.name).join(" ")).toLowerCase();
    if (/auth|token|bearer|authorization/.test(classText)) hints.push("auth");
    if (/log|logger|pretty/.test(classText)) hints.push("logging");
    if (/retry|backoff/.test(classText)) hints.push("retry");
    if (/error|exception|fail/.test(classText)) hints.push("error-handling");
    if (/cache/.test(classText)) hints.push("cache");

    out.push({ name: cls.name, file: filePath, hints });
  }

  // Also detect inline wrapper registrations: dio.interceptors.add(InterceptorsWrapper(...))
  // These don't have a class name — surface them as anonymous with the file path.
  const wrapperRe = /\.interceptors\.add\s*\(\s*InterceptorsWrapper\s*\(/g;
  if (wrapperRe.test(content)) {
    // Only add if we haven't already captured a class-based interceptor from this file
    if (!out.some((i) => i.file === filePath)) {
      out.push({ name: "InterceptorsWrapper (inline)", file: filePath, hints: [] });
    }
  }

  // pretty_dio_logger usage
  if (/PrettyDioLogger\s*\(/.test(content)) {
    out.push({ name: "PrettyDioLogger", file: filePath, hints: ["logging"] });
  }

  return out;
}

function groupByResource(endpoints: ApiEndpoint[]): Record<string, ApiEndpoint[]> {
  const grouped: Record<string, ApiEndpoint[]> = {};

  for (const ep of endpoints) {
    // Extract resource from path: /auth/login → Auth, /products/:id → Products
    const pathParts = ep.path.replace(/^\//, "").split("/");
    const resource = pathParts[0] || "Other";
    const capitalized = resource.charAt(0).toUpperCase() + resource.slice(1);

    if (!grouped[capitalized]) grouped[capitalized] = [];
    grouped[capitalized].push(ep);
  }

  return grouped;
}

export async function scanApiClient(options: ScanOptions): Promise<ScanResult | null> {
  const httpPackage = detectHttpPackage(options.rootDir);
  if (httpPackage === "unknown") return null;

  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  });

  const allEndpoints: ApiEndpoint[] = [];
  const interceptors: InterceptorInfo[] = [];
  let baseUrl: string | null = null;

  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (filePath.endsWith(".g.dart") || filePath.endsWith(".freezed.dart")) continue;

    // Try to find base URL
    if (!baseUrl) {
      baseUrl = extractBaseUrl(content);
    }

    const classes = getDartClasses(filePath, content);

    switch (httpPackage) {
      case "dio":
        allEndpoints.push(...parseDioCalls(content, filePath));
        interceptors.push(...parseInterceptors(classes, content, filePath));
        break;
      case "retrofit":
        allEndpoints.push(...parseRetrofitMethods(classes, content, filePath));
        // Retrofit uses Dio underneath, also check for raw Dio calls
        allEndpoints.push(...parseDioCalls(content, filePath));
        interceptors.push(...parseInterceptors(classes, content, filePath));
        break;
      case "http":
        allEndpoints.push(...parseHttpPackageCalls(content, filePath));
        break;
      case "chopper":
        allEndpoints.push(...parseChopperMethods(classes, content, filePath));
        break;
    }
  }

  if (allEndpoints.length === 0 && interceptors.length === 0) return null;

  // Deduplicate by method + path
  const seen = new Set<string>();
  const uniqueEndpoints = allEndpoints.filter((ep) => {
    const key = `${ep.method} ${ep.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Build markdown
  const sections: string[] = [heading(1, "API Client")];

  if (baseUrl) {
    sections.push(`## Base URL: \`${baseUrl}\``);
  }

  // Interceptors — surface before endpoints so assistants know how requests
  // are mutated globally (auth headers, retry, logging) before reading any
  // specific endpoint.
  if (interceptors.length > 0) {
    const seen = new Set<string>();
    const uniqueInterceptors = interceptors.filter((i) => {
      const key = `${i.name}|${i.file}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const lines = uniqueInterceptors.map((i) => {
      const rel = path.relative(options.rootDir, i.file).replace(/\\/g, "/");
      const tags = i.hints.length > 0 ? ` [${i.hints.join(", ")}]` : "";
      return `${i.name}${tags} — ${rel}`;
    });
    sections.push(joinSections(heading(2, "Interceptors"), bulletList(lines)));
  }

  const grouped = groupByResource(uniqueEndpoints);

  for (const [resource, endpoints] of Object.entries(grouped).sort()) {
    const items = endpoints.map((ep) => {
      const parts = [`${ep.method.padEnd(6)} ${ep.path}`];
      if (ep.responseType) parts.push(`→ ${ep.responseType}`);
      if (ep.bodyType) parts.push(`(body: ${ep.bodyType})`);
      if (ep.queryParams && ep.queryParams.length > 0) {
        parts.push(`(query: ${ep.queryParams.join(", ")})`);
      }
      return parts.join("  ");
    });

    sections.push(joinSections(heading(2, resource), bulletList(items)));
  }

  return {
    filename: "api-client.md",
    content: sections.join("\n\n") + "\n",
  };
}
