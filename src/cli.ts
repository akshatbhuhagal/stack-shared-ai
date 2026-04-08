import { Command } from "commander";
import * as path from "path";
import { loadConfigFile, mergeConfig, Config } from "./config";
import { run, registerScanner, registerCrossStackScanner } from "./runner";
import { FlutterScanner } from "./scanners/flutter/index";
import { ExpressScanner } from "./scanners/express/index";
import { NextjsScanner } from "./scanners/nextjs/index";
import { BunScanner } from "./scanners/bun/index";
import { TypeScriptScanner } from "./scanners/typescript/index";
import { overviewScanner } from "./scanners/cross-stack/overview";
import { apiContractScanner } from "./scanners/cross-stack/api-contract";
import { instructionsScanner } from "./scanners/cross-stack/instructions";
import { loadPlugins } from "./plugin-loader";

// Register built-in framework scanners
registerScanner("flutter", async () => new FlutterScanner());
registerScanner("express", async () => new ExpressScanner());
registerScanner("nextjs", async () => new NextjsScanner());
registerScanner("bun", async () => new BunScanner());
registerScanner("typescript", async () => new TypeScriptScanner());

// Register cross-stack scanners (run after framework scanners)
registerCrossStackScanner(apiContractScanner);
registerCrossStackScanner(overviewScanner);
registerCrossStackScanner(instructionsScanner);

const program = new Command();

program
  .name("stack-shared-ai")
  .description("Scan your codebase and generate structured index files for AI assistants")
  .version("0.1.0")
  .argument("[directory]", "Root directory to scan", ".")
  .option("-o, --output <dir>", "Output directory for generated files")
  .option("-i, --include <dirs...>", "Only scan these directories")
  .option("-e, --exclude <dirs...>", "Exclude these directories")
  .option("-f, --framework <frameworks...>", "Force specific framework(s) (skip auto-detection)")
  .option("-s, --schema <path>", "Path to database schema file")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .option("--dry-run", "Preview what would be generated without writing files")
  .option("--verbose", "Show detailed output during scanning")
  .option("--watch", "Re-generate on file changes")
  .option("--plugin <paths...>", "Load user-defined scanner plugin(s) from file path")
  .action(async (directory: string, opts: Record<string, unknown>) => {
    const rootDir = path.resolve(directory);

    // Load config file
    const fileConfig = loadConfigFile(rootDir);

    // Build CLI flags
    const cliFlags: Partial<Config> = {};
    if (opts.output) cliFlags.output = opts.output as string;
    if (opts.include) cliFlags.include = opts.include as string[];
    if (opts.exclude) cliFlags.exclude = opts.exclude as string[];
    if (opts.framework) cliFlags.frameworks = opts.framework as string[];
    if (opts.schema) cliFlags.schema = opts.schema as string;
    if (opts.format) cliFlags.format = opts.format as Config["format"];
    if (opts.dryRun) cliFlags.dryRun = true;
    if (opts.verbose) cliFlags.verbose = true;
    if (opts.watch) cliFlags.watch = true;
    if (opts.plugin) cliFlags.plugins = opts.plugin as string[];

    const config = mergeConfig(fileConfig, cliFlags);

    if (config.verbose) {
      console.log("Config:", JSON.stringify(config, null, 2));
    }

    try {
      if (config.plugins.length > 0) {
        await loadPlugins(rootDir, config.plugins, config.verbose);
      }
      await run(rootDir, config);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
