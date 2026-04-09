import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const CATEGORY_MAP: Record<string, string[]> = {
  "NestJS Core": [
    "@nestjs/core", "@nestjs/common", "@nestjs/platform-express",
    "@nestjs/platform-fastify", "@nestjs/platform-socket.io", "@nestjs/platform-ws",
    "reflect-metadata", "rxjs",
  ],
  "NestJS Modules": [
    "@nestjs/config", "@nestjs/swagger", "@nestjs/cqrs", "@nestjs/event-emitter",
    "@nestjs/schedule", "@nestjs/cache-manager", "@nestjs/bull", "@nestjs/bullmq",
    "@nestjs/throttler", "@nestjs/jwt", "@nestjs/passport", "@nestjs/mapped-types",
    "@nestjs/serve-static", "@nestjs/websockets", "@nestjs/microservices",
    "@nestjs/terminus", "@nestjs/axios",
  ],
  "Database / ORM": [
    "@nestjs/typeorm", "typeorm",
    "@nestjs/mongoose", "mongoose",
    "@nestjs/sequelize", "sequelize",
    "@nestjs/prisma", "@prisma/client", "prisma",
    "@mikro-orm/nestjs", "@mikro-orm/core",
    "drizzle-orm", "pg", "mysql2", "sqlite3", "redis", "ioredis",
  ],
  "Auth": [
    "passport", "passport-local", "passport-jwt", "passport-google-oauth20",
    "jsonwebtoken", "bcrypt", "bcryptjs", "argon2",
  ],
  "Validation": [
    "class-validator", "class-transformer", "joi", "zod", "yup",
  ],
  "API / GraphQL": [
    "@nestjs/graphql", "@nestjs/apollo", "apollo-server-express",
    "@apollo/server", "graphql", "type-graphql",
  ],
  "Testing": [
    "@nestjs/testing", "jest", "@types/jest", "ts-jest",
    "supertest", "@types/supertest", "vitest",
  ],
  "TypeScript / Build": [
    "typescript", "ts-node", "tsx", "@nestjs/cli", "@nestjs/schematics",
    "@types/node", "@types/express",
  ],
  "Linting / Formatting": [
    "eslint", "prettier",
    "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin",
    "husky", "lint-staged",
  ],
  "Utilities": [
    "dotenv", "lodash", "date-fns", "dayjs", "uuid", "nanoid",
    "winston", "pino", "nest-winston",
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

  if (Object.keys(groupedDeps).length > 0) {
    sections.push(heading(2, "Runtime"));
    sections.push(...formatDepList(groupedDeps));
  }

  if (Object.keys(groupedDevDeps).length > 0) {
    sections.push(heading(2, "Dev"));
    sections.push(...formatDepList(groupedDevDeps));
  }

  return {
    filename: "deps.md",
    content: sections.join("\n\n") + "\n",
  };
}
