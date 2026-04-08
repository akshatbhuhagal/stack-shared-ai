export interface ScanOptions {
  include?: string[];
  exclude?: string[];
  schema?: string;
  rootDir: string;
  format: "markdown" | "json";
  verbose: boolean;
}

export interface ScanResult {
  filename: string;
  content: string;
}

export interface Scanner {
  name: string;
  detect(rootDir: string): Promise<boolean>;
  scan(options: ScanOptions): Promise<ScanResult[]>;
}

// Cross-stack scanners run after framework scanners and consume their output.
// They can also re-scan files via ScanOptions if needed.
export interface CrossStackScanner {
  name: string;
  scan(
    allResults: ScanResult[],
    frameworks: string[],
    options: ScanOptions,
  ): Promise<ScanResult | null>;
}

// Plugin module shape. A plugin file (JS/TS) is `require()`d by the runner.
// It may export any of these via default export or named `plugin` export.
// The loader then wires each entry into the correct registry.
export interface StackSharedAIPlugin {
  name: string;
  // Register a new framework scanner (or override a built-in by reusing the
  // same framework key). `framework` is a free-form string — plugins can
  // introduce new frameworks (e.g. "nextjs", "django").
  framework?: {
    key: string;
    scanner: Scanner;
  };
  // Register extra cross-stack scanners that run after all framework scanners.
  crossStack?: CrossStackScanner[];
}
