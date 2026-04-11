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
import { scanAssets } from "./assets";
import { scanTheme } from "./theme";
import { scanL10n } from "./l10n";
import { scanDi } from "./di";
import { scanApp } from "./app";
import { scanRepositories } from "./repositories";
import { walkFiles } from "../../utils/file-walker";
import { runDartExtractor, isDartAvailable } from "../../utils/dart-analyzer-bridge";
import { primeDartCache, clearDartCache } from "../../utils/dart-parser";

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

    // Pre-warm the Dart symbol cache via the analyzer helper in one batch.
    // Sub-scanners will transparently use these results via `getDartClasses`
    // / `getDartEnums`; falls back to the regex parser if Dart is missing.
    clearDartCache();
    if (isDartAvailable()) {
      const dartFiles = walkFiles(options.rootDir, {
        include: options.include,
        exclude: options.exclude,
        extensions: [".dart"],
      }).filter(
        (f) => !f.endsWith(".g.dart") && !f.endsWith(".freezed.dart"),
      );
      const analyzed = runDartExtractor(dartFiles, options.verbose);
      if (analyzed) {
        primeDartCache(analyzed);
        log(`  [flutter] Dart analyzer primed cache for ${analyzed.size} file(s)`);
      } else {
        log(`  [flutter] Dart analyzer unavailable — using regex parser fallback`);
      }
    } else if (options.verbose) {
      log(`  [flutter] Dart SDK not on PATH — using regex parser`);
    }

    const scanners = [
      { name: "deps", fn: scanDeps },
      { name: "app", fn: scanApp },
      { name: "models", fn: scanModels },
      { name: "components", fn: scanComponents },
      { name: "screens", fn: scanScreens },
      { name: "state", fn: scanState },
      { name: "api-client", fn: scanApiClient },
      { name: "repositories", fn: scanRepositories },
      { name: "theme", fn: scanTheme },
      { name: "l10n", fn: scanL10n },
      { name: "di", fn: scanDi },
      { name: "assets", fn: scanAssets },
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
