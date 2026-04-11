import * as fs from "fs";
import * as path from "path";
import { Config } from "./config";
import { Scanner, CrossStackScanner, ScanOptions, ScanResult } from "./scanners/types";
import { detectFrameworks, Framework } from "./detector";
import { Spinner } from "./utils/spinner";

// Framework scanner registry
const scannerRegistry: Map<Framework, () => Promise<Scanner>> = new Map();

// Cross-stack scanner registry — these run after framework scanners and
// consume the aggregated ScanResult[] from all framework scanners.
const crossStackScanners: CrossStackScanner[] = [];

export function registerScanner(framework: Framework, loader: () => Promise<Scanner>): void {
  scannerRegistry.set(framework, loader);
}

export function registerCrossStackScanner(scanner: CrossStackScanner): void {
  crossStackScanners.push(scanner);
}

export async function run(rootDir: string, config: Config): Promise<void> {
  await runOnce(rootDir, config);

  if (config.watch) {
    await startWatch(rootDir, config);
  }
}

async function runOnce(rootDir: string, config: Config): Promise<void> {
  const log = config.verbose ? console.log : () => {};
  // Spinner is disabled in verbose mode (would clobber logs) and in watch mode
  // where we want quieter re-runs.
  const spinner = new Spinner({ enabled: !config.verbose && !!process.stdout.isTTY });

  // Detect frameworks
  let frameworks: Framework[] = [];
  let detected: Awaited<ReturnType<typeof detectFrameworks>> | null = null;

  if (config.frameworks.length > 0) {
    frameworks = config.frameworks as Framework[];
    console.log(`Using specified frameworks: ${frameworks.join(", ")}`);
  } else {
    spinner.start("Detecting frameworks...");
    detected = await detectFrameworks(rootDir);
    if (detected.length === 0) {
      spinner.fail("No supported frameworks detected.");
      return;
    }
    const frameworkList = [...new Set(detected.map((d) => d.framework))];
    spinner.succeed(
      `Detected ${frameworkList.length} framework${frameworkList.length === 1 ? "" : "s"}: ${frameworkList.join(", ")}`,
    );
    if (config.verbose) {
      for (const d of detected) {
        console.log(`  ${d.framework} (${d.confidence}) — ${d.signal}`);
      }
    }
    frameworks = frameworkList;
  }

  // Run framework scanners, keeping results grouped by framework so we can
  // detect filename collisions (e.g. both Flutter and Express produce deps.md).
  const perFrameworkResults: { framework: Framework; results: ScanResult[] }[] = [];

  for (const framework of frameworks) {
    const loader = scannerRegistry.get(framework);
    if (!loader) {
      console.log(`No scanner registered for framework: ${framework}`);
      continue;
    }

    // Collect all directories where this framework was detected (monorepo).
    // For user-specified frameworks, fall back to the CLI rootDir.
    const detectedDirs = detected
      ? [...new Set(detected.filter((d) => d.framework === framework).map((d) => d.rootDir))]
      : [rootDir];

    for (const scanDir of detectedDirs) {
      const scanner = await loader();
      const canScan = await scanner.detect(scanDir);
      if (!canScan) {
        log(`Scanner ${scanner.name} declined to scan ${scanDir} (detect returned false)`);
        continue;
      }

      const scanOptions: ScanOptions = {
        rootDir: scanDir,
        include: config.include,
        exclude: config.exclude,
        schema: config.schema,
        format: config.format,
        verbose: config.verbose,
      };

      const relDir = path.relative(rootDir, scanDir) || ".";
      spinner.start(`Scanning ${scanner.name} in ${relDir}...`);
      log(`Running scanner: ${scanner.name} on ${scanDir}`);
      const results = await scanner.scan(scanOptions);
      perFrameworkResults.push({ framework, results });
      spinner.succeed(`Scanned ${scanner.name} (${relDir}) → ${results.length} file${results.length === 1 ? "" : "s"}`);
      log(`  Generated ${results.length} file(s)`);
    }
  }

  // Collision resolution: if more than one framework produced results, prefix
  // any filename that appears in multiple frameworks with the framework name.
  const filenameCounts = new Map<string, number>();
  for (const { results } of perFrameworkResults) {
    for (const r of results) {
      filenameCounts.set(r.filename, (filenameCounts.get(r.filename) ?? 0) + 1);
    }
  }

  const allResults: ScanResult[] = [];
  for (const { framework, results } of perFrameworkResults) {
    for (const r of results) {
      const collides = (filenameCounts.get(r.filename) ?? 0) > 1;
      allResults.push(
        collides ? { ...r, filename: `${framework}-${r.filename}` } : r,
      );
    }
  }

  // Run cross-stack scanners (overview, api-contract, etc.)
  const crossStackOptions: ScanOptions = {
    rootDir,
    include: config.include,
    exclude: config.exclude,
    schema: config.schema,
    format: config.format,
    verbose: config.verbose,
  };
  if (crossStackScanners.length > 0) {
    spinner.start("Running cross-stack scanners...");
    for (const crossScanner of crossStackScanners) {
      try {
        spinner.update(`Running cross-stack scanner: ${crossScanner.name}...`);
        log(`Running cross-stack scanner: ${crossScanner.name}`);
        const result = await crossScanner.scan(allResults, frameworks, crossStackOptions);
        if (result) {
          allResults.push(result);
          log(`  Generated ${result.filename}`);
        } else {
          log(`  Cross-stack scanner ${crossScanner.name} produced no output`);
        }
      } catch (err) {
        console.warn(`Error in cross-stack scanner ${crossScanner.name}: ${err}`);
      }
    }
    spinner.succeed("Cross-stack scanners complete");
  }

  if (allResults.length === 0) {
    spinner.fail("No output files generated.");
    return;
  }

  // Write output
  const outputDir = path.resolve(rootDir, config.output);

  if (config.dryRun) {
    console.log(`\nDry run — would write to ${outputDir}/:`);
    if (config.format === "json") {
      const total = allResults.reduce((n, r) => n + r.content.length, 0);
      console.log(`  index.json (${total} chars across ${allResults.length} entries)`);
    } else {
      for (const result of allResults) {
        console.log(`  ${result.filename} (${result.content.length} chars)`);
      }
    }
    return;
  }

  spinner.start(`Writing ${allResults.length} file${allResults.length === 1 ? "" : "s"} to ${config.output}/...`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (config.format === "json") {
    const bundle = {
      generatedAt: new Date().toISOString(),
      frameworks,
      files: allResults.map((r) => ({
        filename: r.filename,
        content: r.content,
      })),
    };
    const filePath = path.join(outputDir, "index.json");
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), "utf-8");
    log(`  Wrote ${filePath}`);
    spinner.succeed(`Generated index.json (${allResults.length} entries) in ${config.output}/`);
  } else {
    for (const result of allResults) {
      const filePath = path.join(outputDir, result.filename);
      fs.writeFileSync(filePath, result.content, "utf-8");
      log(`  Wrote ${filePath}`);
    }
    spinner.succeed(`Generated ${allResults.length} file${allResults.length === 1 ? "" : "s"} in ${config.output}/`);
  }
}

// Watch mode — re-run scanners when source files change. Uses node's built-in
// fs.watch with recursive: true (supported on Windows and macOS; on Linux it
// falls back to a non-recursive watch of the root dir).
async function startWatch(rootDir: string, config: Config): Promise<void> {
  const outputDir = path.resolve(rootDir, config.output);
  const excludes = new Set([...(config.exclude ?? []), ".stack-shared-ai", "node_modules", ".git", "dist", "build", ".dart_tool"]);

  console.log(`\nWatching ${rootDir} for changes... (Ctrl+C to stop)`);

  let pending = false;
  let running = false;
  const trigger = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      console.log("\n[watch] Change detected, regenerating...");
      await runOnce(rootDir, config);
    } catch (err) {
      console.error("[watch] Error:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        setTimeout(trigger, 100);
      }
    }
  };

  let debounceTimer: NodeJS.Timeout | null = null;
  const onChange = (_event: string, filename: string | null) => {
    if (!filename) return;
    // Ignore changes inside excluded directories and output dir
    const top = filename.split(/[\\/]/)[0];
    if (excludes.has(top)) return;
    const abs = path.resolve(rootDir, filename);
    if (abs.startsWith(outputDir)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(trigger, 250);
  };

  try {
    fs.watch(rootDir, { recursive: true }, onChange);
  } catch {
    // recursive watch not supported (older Linux); fall back to non-recursive
    fs.watch(rootDir, onChange);
  }

  // Keep the process alive indefinitely
  return new Promise(() => {});
}
