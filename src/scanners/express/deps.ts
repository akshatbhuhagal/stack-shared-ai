import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const CATEGORY_MAP: Record<string, string[]> = {
  "Web Framework": [
    "express", "cors", "helmet", "compression", "morgan",
    "body-parser", "cookie-parser", "express-session",
    "express-rate-limit", "express-validator", "multer",
    "connect-redis", "serve-static", "express-async-errors",
  ],
  "Database / ORM": [
    "prisma", "@prisma/client",
    "drizzle-orm", "drizzle-kit",
    "typeorm", "sequelize", "sequelize-typescript",
    "mongoose", "mongodb",
    "pg", "mysql", "mysql2", "sqlite3", "better-sqlite3",
    "knex", "kysely", "objection",
    "redis", "ioredis",
  ],
  "Auth": [
    "passport", "passport-local", "passport-jwt", "passport-google-oauth20",
    "jsonwebtoken", "bcrypt", "bcryptjs", "argon2",
    "@auth/express", "next-auth", "lucia",
    "express-jwt", "oauth2-server",
  ],
  "Validation": [
    "zod", "joi", "yup", "ajv",
    "class-validator", "class-transformer",
    "express-validator", "superstruct",
  ],
  "API / GraphQL": [
    "apollo-server-express", "@apollo/server", "graphql",
    "type-graphql", "graphql-tools", "graphql-yoga",
    "trpc", "@trpc/server",
    "swagger-ui-express", "swagger-jsdoc",
  ],
  "Utilities": [
    "dotenv", "dotenv-safe",
    "lodash", "ramda", "date-fns", "dayjs", "moment",
    "uuid", "nanoid", "ms",
    "axios", "node-fetch", "got",
    "winston", "pino", "bunyan",
    "chalk", "commander", "yargs",
  ],
  "File / Upload": [
    "multer", "sharp", "jimp",
    "aws-sdk", "@aws-sdk/client-s3",
    "formidable", "busboy",
  ],
  "Messaging / Queue": [
    "bull", "bullmq", "agenda",
    "amqplib", "kafkajs", "rabbitmq",
    "socket.io", "ws", "nodemailer",
  ],
  "Testing": [
    "jest", "@types/jest", "ts-jest",
    "mocha", "chai", "sinon",
    "supertest", "@types/supertest",
    "vitest", "@vitest/ui",
    "playwright", "cypress",
  ],
  "TypeScript / Build": [
    "typescript", "ts-node", "tsx", "nodemon",
    "esbuild", "tsup", "swc", "@swc/core",
    "@types/node", "@types/express",
  ],
  "Linting / Formatting": [
    "eslint", "prettier",
    "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin",
    "husky", "lint-staged",
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
