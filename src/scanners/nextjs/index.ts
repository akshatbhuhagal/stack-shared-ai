import * as fs from "fs";
import * as path from "path";
import { Scanner, ScanOptions, ScanResult } from "../types";
import { scanDeps } from "./deps";
import { scanRoutes } from "./routes";
import { scanLayouts } from "./layouts";
import { scanServerActions } from "./server-actions";
import { scanMiddleware } from "./middleware";
import { scanComponents } from "./components";
import { scanConfig } from "./config";

export class NextjsScanner implements Scanner {
  name = "nextjs";

  async detect(rootDir: string): Promise<boolean> {
    const pkgPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return !!deps.next;
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
      { name: "layouts", fn: scanLayouts },
      { name: "server-actions", fn: scanServerActions },
      { name: "middleware", fn: scanMiddleware },
      { name: "components", fn: scanComponents },
      { name: "config", fn: scanConfig },
    ];

    for (const scanner of scanners) {
      try {
        log(`  [nextjs] Scanning ${scanner.name}...`);
        const result = await scanner.fn(options);
        if (result) {
          results.push(result);
          log(`  [nextjs] Generated ${result.filename}`);
        } else {
          log(`  [nextjs] No output for ${scanner.name}`);
        }
      } catch (err) {
        console.warn(`  [nextjs] Error in ${scanner.name} scanner: ${err}`);
      }
    }

    return results;
  }
}
