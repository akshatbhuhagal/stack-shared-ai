import * as fs from "fs";
import * as path from "path";
import { Scanner, ScanOptions, ScanResult } from "../types";
import { scanDeps } from "./deps";
import { scanRoutes } from "./routes";
import { scanMiddleware } from "./middleware";
import { scanSchema } from "./schema";
import { scanServices } from "./services";
import { scanConfig } from "./config";

export class ExpressScanner implements Scanner {
  name = "express";

  async detect(rootDir: string): Promise<boolean> {
    const packageJsonPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) return false;
    try {
      const content = fs.readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return !!deps.express;
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
      { name: "middleware", fn: scanMiddleware },
      { name: "schema", fn: scanSchema },
      { name: "services", fn: scanServices },
      { name: "config", fn: scanConfig },
    ];

    for (const scanner of scanners) {
      try {
        log(`  [express] Scanning ${scanner.name}...`);
        const result = await scanner.fn(options);
        if (result) {
          results.push(result);
          log(`  [express] Generated ${result.filename}`);
        } else {
          log(`  [express] No output for ${scanner.name}`);
        }
      } catch (err) {
        console.warn(`  [express] Error in ${scanner.name} scanner: ${err}`);
      }
    }

    return results;
  }
}
