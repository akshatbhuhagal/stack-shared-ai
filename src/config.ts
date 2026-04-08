import * as fs from "fs";
import * as path from "path";

export interface Config {
  output: string;
  include: string[];
  exclude: string[];
  schema?: string;
  frameworks: string[];
  format: "markdown" | "json";
  verbose: boolean;
  dryRun: boolean;
  watch: boolean;
  plugins: string[];
}

const CONFIG_FILENAME = "stack-shared-ai.config.json";

const DEFAULT_CONFIG: Config = {
  output: ".stack-shared-ai",
  include: [],
  exclude: ["node_modules", ".dart_tool", "build", "dist", ".git", "__mocks__", "tests", "test"],
  frameworks: [],
  format: "markdown",
  verbose: false,
  dryRun: false,
  watch: false,
  plugins: [],
};

export function loadConfigFile(rootDir: string): Partial<Config> {
  const configPath = path.join(rootDir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Warning: Failed to parse ${CONFIG_FILENAME}: ${err}`);
    return {};
  }
}

export function mergeConfig(fileConfig: Partial<Config>, cliFlags: Partial<Config>): Config {
  return {
    output: cliFlags.output ?? fileConfig.output ?? DEFAULT_CONFIG.output,
    include: cliFlags.include?.length ? cliFlags.include : fileConfig.include ?? DEFAULT_CONFIG.include,
    exclude: cliFlags.exclude?.length ? cliFlags.exclude : fileConfig.exclude ?? DEFAULT_CONFIG.exclude,
    schema: cliFlags.schema ?? fileConfig.schema ?? DEFAULT_CONFIG.schema,
    frameworks: cliFlags.frameworks?.length ? cliFlags.frameworks : fileConfig.frameworks ?? DEFAULT_CONFIG.frameworks,
    format: cliFlags.format ?? fileConfig.format ?? DEFAULT_CONFIG.format,
    verbose: cliFlags.verbose ?? fileConfig.verbose ?? DEFAULT_CONFIG.verbose,
    dryRun: cliFlags.dryRun ?? fileConfig.dryRun ?? DEFAULT_CONFIG.dryRun,
    watch: cliFlags.watch ?? fileConfig.watch ?? DEFAULT_CONFIG.watch,
    plugins: cliFlags.plugins?.length ? cliFlags.plugins : fileConfig.plugins ?? DEFAULT_CONFIG.plugins,
  };
}
