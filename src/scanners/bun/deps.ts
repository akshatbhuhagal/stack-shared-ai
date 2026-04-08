import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const CATEGORY_MAP: Record<string, string[]> = {
  "Bun Runtime": [
    "@types/bun", "bun-types",
  ],
  "Web Frameworks (Bun-friendly)": [
    "hono", "@hono/node-server", "@hono/zod-validator",
    "elysia", "@elysiajs/cors", "@elysiajs/swagger", "@elysiajs/jwt", "@elysiajs/static",
    "express", "fastify", "koa",
  ],
  "Database / ORM": [
    "drizzle-orm", "drizzle-kit",
    "@libsql/client", "@neondatabase/serverless",
    "prisma", "@prisma/client",
    "mongoose", "mongodb", "redis", "ioredis",
    "bun:sqlite",
  ],
  "Auth": [
    "lucia", "@lucia-auth/adapter-prisma",
    "jose", "jsonwebtoken", "bcryptjs",
    "@auth/core",
  ],
  "Validation": [
    "zod", "valibot", "typebox", "@sinclair/typebox",
    "yup", "joi",
  ],
  "Testing": [
    "bun:test",
    "vitest", "@vitest/ui",
  ],
  "TypeScript / Build": [
    "typescript", "@types/node",
  ],
  "Linting / Formatting": [
    "eslint", "prettier", "biome", "@biomejs/biome",
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

  if (Object.keys(deps).length === 0 && Object.keys(devDeps).length === 0) return null;

  const groupedDeps: Record<string, string[]> = {};
  for (const [name, version] of Object.entries(deps)) {
    const cat = categorize(name);
    if (!groupedDeps[cat]) groupedDeps[cat] = [];
    groupedDeps[cat].push(`${name}: ${version}`);
  }

  const groupedDevDeps: Record<string, string[]> = {};
  for (const [name, version] of Object.entries(devDeps)) {
    const cat = categorize(name);
    if (!groupedDevDeps[cat]) groupedDevDeps[cat] = [];
    groupedDevDeps[cat].push(`${name}: ${version}`);
  }

  const sections: string[] = [heading(1, "Dependencies")];

  // Bun runtime info
  sections.push(joinSections(heading(2, "Runtime"), "- Bun"));

  if (Object.keys(groupedDeps).length > 0) {
    sections.push(heading(2, "Dependencies"));
    sections.push(...formatDepList(groupedDeps));
  }

  if (Object.keys(groupedDevDeps).length > 0) {
    sections.push(heading(2, "Dev Dependencies"));
    sections.push(...formatDepList(groupedDevDeps));
  }

  return {
    filename: "deps.md",
    content: sections.join("\n\n") + "\n",
  };
}
