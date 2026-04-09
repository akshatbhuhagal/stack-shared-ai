import * as fs from "fs";
import * as path from "path";
import { Scanner, ScanOptions, ScanResult } from "../types";
import { scanDeps } from "./deps";
import { scanControllers } from "./controllers";
import { scanModules } from "./modules";
import { scanProviders } from "./providers";
import { scanConfig } from "./config";

export class NestjsScanner implements Scanner {
  name = "nestjs";

  async detect(rootDir: string): Promise<boolean> {
    const pkgPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return !!(deps["@nestjs/core"] || deps["@nestjs/common"]);
    } catch {
      return false;
    }
  }

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const log = options.verbose ? console.log : () => {};

    const scanners = [
      { name: "deps", fn: scanDeps },
      { name: "controllers", fn: scanControllers },
      { name: "modules", fn: scanModules },
      { name: "providers", fn: scanProviders },
      { name: "config", fn: scanConfig },
    ];

    for (const scanner of scanners) {
      try {
        log(`  [nestjs] Scanning ${scanner.name}...`);
        const result = await scanner.fn(options);
        if (result) {
          results.push(result);
          log(`  [nestjs] Generated ${result.filename}`);
        } else {
          log(`  [nestjs] No output for ${scanner.name}`);
        }
      } catch (err) {
        console.warn(`  [nestjs] Error in ${scanner.name} scanner: ${err}`);
      }
    }

    return results;
  }
}
