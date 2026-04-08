import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const CATEGORY_MAP: Record<string, string[]> = {
  "TypeScript / Build": [
    "typescript", "ts-node", "tsx", "tsup", "esbuild", "swc", "@swc/core",
    "rollup", "@rollup/plugin-typescript", "vite", "tsc-watch",
    "@types/node",
  ],
  "Testing": [
    "jest", "ts-jest", "@types/jest",
    "vitest", "@vitest/ui",
    "mocha", "chai", "@types/mocha",
    "ava", "tap", "uvu",
  ],
  "Linting / Formatting": [
    "eslint", "prettier", "biome", "@biomejs/biome",
    "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin",
    "husky", "lint-staged",
  ],
  "Validation": [
    "zod", "yup", "joi", "valibot", "superstruct", "io-ts", "runtypes",
  ],
  "Utilities": [
    "lodash", "ramda", "date-fns", "dayjs",
    "uuid", "nanoid", "ms",
    "axios", "node-fetch", "ky", "ofetch",
    "chalk", "kleur", "picocolors",
    "commander", "yargs", "minimist",
  ],
};

function categorize(pkg: string): string {
  for (const [category, packages] of Object.entries(CATEGORY_MAP)) {
    if (packages.includes(pkg)) return category;
  }
  return "Other";
}

function formatDepList(grouped: Record<string, string[]>): string[] {
  const sections: string[] = [];
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });
  for (const cat of sortedCategories) {
    sections.push(joinSections(heading(3, cat), bulletList(grouped[cat])));
  }
  return sections;
}

export async function scanDeps(options: ScanOptions): Promise<ScanResult | null> {
  const pkgPath = path.join(options.rootDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }

  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const peerDeps = (pkg.peerDependencies ?? {}) as Record<string, string>;

  if (
    Object.keys(deps).length === 0 &&
    Object.keys(devDeps).length === 0 &&
    Object.keys(peerDeps).length === 0
  ) return null;

  const sections: string[] = [heading(1, "Dependencies")];

  const groupAndAdd = (label: string, raw: Record<string, string>) => {
    if (Object.keys(raw).length === 0) return;
    const grouped: Record<string, string[]> = {};
    for (const [name, version] of Object.entries(raw)) {
      const cat = categorize(name);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`${name}: ${version}`);
    }
    sections.push(heading(2, label));
    sections.push(...formatDepList(grouped));
  };

  groupAndAdd("Runtime", deps);
  groupAndAdd("Peer", peerDeps);
  groupAndAdd("Dev", devDeps);

  return {
    filename: "deps.md",
    content: sections.join("\n\n") + "\n",
  };
}
