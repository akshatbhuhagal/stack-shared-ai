import * as path from "path";
import { CrossStackScanner, ScanResult, ScanOptions } from "../types";
import { heading, joinSections, bulletList, bold } from "../../utils/markdown";

// Count second-level headings (##) in a markdown doc.
function countH2(md: string): number {
  return (md.match(/^## /gm) ?? []).length;
}

// Count third-level headings (###) in a markdown doc.
function countH3(md: string): number {
  return (md.match(/^### /gm) ?? []).length;
}

// Count bullet list items.
function countBullets(md: string): number {
  return (md.match(/^- /gm) ?? []).length;
}

// Count HTTP-method prefixed lines in routes.md / api-client.md
function countEndpoints(md: string): number {
  return (md.match(/^- (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL) /gm) ?? []).length;
}

// Extract the first "## Package: X" or "## ORM: X" value.
function extractLabeledH2(md: string, label: string): string | null {
  const re = new RegExp(`^## ${label}:\\s*(.+)$`, "m");
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

// Extract the `**Source:** value` line.
function extractBoldKV(md: string, key: string): string | null {
  const re = new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "m");
  const m = md.match(re);
  return m ? m[1].replace(/`/g, "").trim() : null;
}

// Lookup a framework's file by either the plain or framework-prefixed form.
// The runner prefixes filenames when two frameworks produce the same name
// (e.g. Flutter and Express both emit deps.md → flutter-deps.md + express-deps.md).
function getFrameworkFile(
  results: Map<string, string>,
  framework: string,
  filename: string,
): string | undefined {
  return results.get(filename) ?? results.get(`${framework}-${filename}`);
}

function summarizeFlutter(results: Map<string, string>): string[] {
  const sections: string[] = [];

  const deps = getFrameworkFile(results, "flutter", "deps.md");
  const models = getFrameworkFile(results, "flutter", "models.md");
  const components = getFrameworkFile(results, "flutter", "components.md");
  const screens = getFrameworkFile(results, "flutter", "screens.md");
  const state = getFrameworkFile(results, "flutter", "state.md");
  const apiClient = getFrameworkFile(results, "flutter", "api-client.md");

  const highlights: string[] = [];

  if (deps) {
    const depCount = countBullets(deps);
    highlights.push(`${depCount} dependencies`);
  }
  if (models) {
    const modelCount = countH2(models) - 1; // subtract "Enums" section if present
    highlights.push(`${modelCount >= 0 ? modelCount : countH2(models)} data models`);
  }
  if (components) {
    highlights.push(`${countBullets(components)} reusable widgets`);
  }
  if (screens) {
    const router = extractLabeledH2(screens, "Navigation");
    const routeCount = countBullets(screens);
    highlights.push(`${routeCount} routes${router ? ` via ${router}` : ""}`);
  }
  if (state) {
    const pkg = extractLabeledH2(state, "Package");
    const providerCount = countH3(state);
    highlights.push(`${providerCount} ${pkg ?? "state"} providers`);
  }
  if (apiClient) {
    const endpointCount = countEndpoints(apiClient);
    highlights.push(`${endpointCount} API calls`);
  }

  if (highlights.length > 0) {
    sections.push(joinSections(heading(2, "Flutter (Mobile)"), bulletList(highlights)));
  }

  return sections;
}

function summarizeExpress(results: Map<string, string>): string[] {
  const sections: string[] = [];

  const deps = getFrameworkFile(results, "express", "deps.md");
  const routes = getFrameworkFile(results, "express", "routes.md");
  const middleware = getFrameworkFile(results, "express", "middleware.md");
  const schema = getFrameworkFile(results, "express", "schema.md");
  const services = getFrameworkFile(results, "express", "services.md");
  const config = getFrameworkFile(results, "express", "config.md");

  const highlights: string[] = [];

  if (deps) {
    highlights.push(`${countBullets(deps)} dependencies`);
  }
  if (routes) {
    highlights.push(`${countEndpoints(routes)} routes`);
  }
  if (middleware) {
    highlights.push(`${countBullets(middleware)} global middlewares`);
  }
  if (schema) {
    const orm = extractLabeledH2(schema, "ORM");
    const modelCount = countH3(schema);
    highlights.push(`${modelCount} ${orm ?? "database"} models`);
  }
  if (services) {
    const serviceCount = countH3(services);
    highlights.push(`${serviceCount} service files`);
  }
  if (config) {
    // Bullet count minus the Source line (which isn't a bullet)
    highlights.push(`${countBullets(config)} env variables`);
  }

  if (highlights.length > 0) {
    sections.push(joinSections(heading(2, "Express (Backend)"), bulletList(highlights)));
  }

  return sections;
}

export const overviewScanner: CrossStackScanner = {
  name: "overview",

  async scan(
    allResults: ScanResult[],
    frameworks: string[],
    options: ScanOptions,
  ): Promise<ScanResult | null> {
    if (allResults.length === 0) return null;

    // Build a map keyed by filename → content
    const resultMap = new Map<string, string>();
    for (const r of allResults) {
      resultMap.set(r.filename, r.content);
    }

    const sections: string[] = [
      heading(1, "Architecture Overview"),
      `${bold("Project")}: ${path.basename(options.rootDir)}`,
      `${bold("Frameworks detected")}: ${frameworks.join(", ")}`,
      `${bold("Generated files")}: ${allResults.length}`,
    ];

    if (frameworks.includes("flutter")) {
      sections.push(...summarizeFlutter(resultMap));
    }

    if (frameworks.includes("express")) {
      sections.push(...summarizeExpress(resultMap));
    }

    // Index of generated files
    const fileList = allResults
      .map((r) => r.filename)
      .sort()
      .map((f) => `\`${f}\``);
    sections.push(joinSections(heading(2, "Generated Index Files"), bulletList(fileList)));

    return {
      filename: "overview.md",
      content: sections.join("\n\n") + "\n",
    };
  },
};
