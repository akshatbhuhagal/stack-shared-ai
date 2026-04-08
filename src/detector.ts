import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

// Built-in framework keys. Plugins may register additional keys — the type
// stays assignable from arbitrary strings at runtime so plugin framework
// names work end-to-end (the `(string & {})` trick preserves autocomplete
// for the literal union while still accepting other strings).
export type Framework = "flutter" | "express" | (string & {});

interface DetectionResult {
  framework: Framework;
  confidence: "high" | "medium";
  signal: string;
}

export async function detectFrameworks(rootDir: string): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  // Check for Flutter
  const pubspecPath = path.join(rootDir, "pubspec.yaml");
  if (fs.existsSync(pubspecPath)) {
    try {
      const content = fs.readFileSync(pubspecPath, "utf-8");
      const pubspec = parseYaml(content);
      if (pubspec?.dependencies?.flutter) {
        results.push({
          framework: "flutter",
          confidence: "high",
          signal: "pubspec.yaml with flutter dependency",
        });
      }
    } catch {
      // If YAML parse fails, still flag it as medium confidence
      results.push({
        framework: "flutter",
        confidence: "medium",
        signal: "pubspec.yaml exists (parse failed)",
      });
    }
  }

  // Check for Express
  const packageJsonPath = path.join(rootDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.express) {
        results.push({
          framework: "express",
          confidence: "high",
          signal: "package.json with express dependency",
        });
      }
    } catch {
      // Skip if package.json can't be parsed
    }
  }

  // Check for monorepo: scan immediate subdirectories
  if (results.length === 0) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        const subResults = await detectFrameworks(path.join(rootDir, entry.name));
        results.push(...subResults);
      }
    }
  }

  return results;
}
