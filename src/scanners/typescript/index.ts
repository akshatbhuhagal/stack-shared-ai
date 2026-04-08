import * as fs from "fs";
import * as path from "path";
import { Scanner, ScanOptions, ScanResult } from "../types";
import { scanDeps } from "./deps";
import { scanExports } from "./exports";
import { scanTypes } from "./types";
import { scanApi } from "./api";

export class TypeScriptScanner implements Scanner {
  name = "typescript";

  async detect(rootDir: string): Promise<boolean> {
    const pkgPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      // Only run if `typescript` is present and no app framework is in deps
      if (!deps.typescript) return false;
      if (deps.next || deps.express || deps["@types/bun"]) return false;
      return true;
    } catch {
      return false;
    }
  }

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const log = options.verbose ? console.log : () => {};

    const scanners = [
      { name: "deps", fn: scanDeps },
      { name: "exports", fn: scanExports },
      { name: "types", fn: scanTypes },
      { name: "api", fn: scanApi },
    ];

    for (const scanner of scanners) {
      try {
        log(`  [typescript] Scanning ${scanner.name}...`);
        const result = await scanner.fn(options);
        if (result) {
          results.push(result);
          log(`  [typescript] Generated ${result.filename}`);
        } else {
          log(`  [typescript] No output for ${scanner.name}`);
        }
      } catch (err) {
        console.warn(`  [typescript] Error in ${scanner.name} scanner: ${err}`);
      }
    }

    return results;
  }
}
