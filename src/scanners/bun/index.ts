import * as fs from "fs";
import * as path from "path";
import { Scanner, ScanOptions, ScanResult } from "../types";
import { scanDeps } from "./deps";
import { scanRoutes } from "./routes";
import { scanConfig } from "./config";

export class BunScanner implements Scanner {
  name = "bun";

  async detect(rootDir: string): Promise<boolean> {
    if (fs.existsSync(path.join(rootDir, "bunfig.toml"))) return true;
    const pkgPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["@types/bun"]) return true;
      const scripts = (pkg.scripts ?? {}) as Record<string, string>;
      return Object.values(scripts).some((s) => /\bbun\b/.test(s));
    } catch {
      return false;
    }
  }

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const log = options.verbose ? console.log : () => {};

    const scanners = [
      { name: "deps", fn: scanDeps },
      { name: "routes", fn: scanRoutes },
      { name: "config", fn: scanConfig },
    ];

    for (const scanner of scanners) {
      try {
        log(`  [bun] Scanning ${scanner.name}...`);
        const result = await scanner.fn(options);
        if (result) {
          results.push(result);
          log(`  [bun] Generated ${result.filename}`);
        } else {
          log(`  [bun] No output for ${scanner.name}`);
        }
      } catch (err) {
        console.warn(`  [bun] Error in ${scanner.name} scanner: ${err}`);
      }
    }

    return results;
  }
}
