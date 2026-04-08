import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { Scanner, ScanOptions, ScanResult } from "../types";
import { scanDeps } from "./deps";
import { scanModels } from "./models";
import { scanComponents } from "./components";
import { scanScreens } from "./screens";
import { scanState } from "./state";
import { scanApiClient } from "./api-client";

export class FlutterScanner implements Scanner {
  name = "flutter";

  async detect(rootDir: string): Promise<boolean> {
    const pubspecPath = path.join(rootDir, "pubspec.yaml");
    if (!fs.existsSync(pubspecPath)) return false;
    try {
      const content = fs.readFileSync(pubspecPath, "utf-8");
      const pubspec = parseYaml(content);
      return !!pubspec?.dependencies?.flutter;
    } catch {
      return false;
    }
  }

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const log = options.verbose ? console.log : () => {};

    const scanners = [
      { name: "deps", fn: scanDeps },
      { name: "models", fn: scanModels },
      { name: "components", fn: scanComponents },
      { name: "screens", fn: scanScreens },
      { name: "state", fn: scanState },
      { name: "api-client", fn: scanApiClient },
    ];

    for (const scanner of scanners) {
      try {
        log(`  [flutter] Scanning ${scanner.name}...`);
        const result = await scanner.fn(options);
        if (result) {
          results.push(result);
          log(`  [flutter] Generated ${result.filename}`);
        } else {
          log(`  [flutter] No output for ${scanner.name}`);
        }
      } catch (err) {
        console.warn(`  [flutter] Error in ${scanner.name} scanner: ${err}`);
      }
    }

    return results;
  }
}
