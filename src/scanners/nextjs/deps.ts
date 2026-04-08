import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const CATEGORY_MAP: Record<string, string[]> = {
  "Next.js Core": [
    "next", "react", "react-dom",
    "@next/font", "@next/bundle-analyzer", "@next/mdx",
    "next-mdx-remote", "next-sitemap", "next-seo", "next-themes",
    "next-intl", "next-international", "next-i18next",
  ],
  "Auth": [
    "next-auth", "@auth/core", "@auth/nextjs", "@auth/prisma-adapter",
    "@clerk/nextjs", "@clerk/clerk-sdk-node",
    "lucia", "@lucia-auth/adapter-prisma",
    "iron-session", "jose", "jsonwebtoken", "bcrypt", "bcryptjs",
    "@kinde-oss/kinde-auth-nextjs", "@workos-inc/node",
  ],
  "Database / ORM": [
    "prisma", "@prisma/client",
    "drizzle-orm", "drizzle-kit",
    "@neondatabase/serverless", "@vercel/postgres",
    "mongoose", "mongodb", "@planetscale/database",
    "kysely", "knex",
    "redis", "@upstash/redis", "@upstash/ratelimit",
    "@supabase/supabase-js", "@supabase/ssr",
  ],
  "State / Data Fetching": [
    "@tanstack/react-query", "swr",
    "zustand", "jotai", "valtio", "recoil",
    "@reduxjs/toolkit", "react-redux",
    "@trpc/server", "@trpc/client", "@trpc/react-query", "@trpc/next",
  ],
  "Forms / Validation": [
    "react-hook-form", "@hookform/resolvers",
    "formik", "final-form", "react-final-form",
    "zod", "yup", "joi", "valibot", "superstruct",
  ],
  "UI / Styling": [
    "tailwindcss", "postcss", "autoprefixer",
    "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
    "shadcn-ui", "class-variance-authority", "clsx", "tailwind-merge",
    "@emotion/react", "@emotion/styled",
    "styled-components", "@stitches/react",
    "@mui/material", "@chakra-ui/react", "antd",
    "framer-motion", "lottie-react", "react-spring",
    "lucide-react", "react-icons", "@heroicons/react",
  ],
  "Content / CMS": [
    "contentlayer", "@contentlayer/source-files",
    "@sanity/client", "next-sanity",
    "@contentful/rich-text-react-renderer", "contentful",
    "gray-matter", "remark", "rehype", "unified",
  ],
  "Analytics / Monitoring": [
    "@vercel/analytics", "@vercel/speed-insights",
    "posthog-js", "posthog-node",
    "@sentry/nextjs", "@sentry/node",
    "mixpanel-browser", "logrocket",
  ],
  "Utilities": [
    "date-fns", "dayjs", "moment",
    "lodash", "ramda", "uuid", "nanoid",
    "axios", "ky", "ofetch",
    "dotenv", "server-only", "client-only",
  ],
  "Testing": [
    "jest", "@jest/globals", "ts-jest", "jest-environment-jsdom",
    "vitest", "@vitest/ui",
    "@testing-library/react", "@testing-library/jest-dom", "@testing-library/user-event",
    "playwright", "@playwright/test", "cypress",
  ],
  "TypeScript / Build": [
    "typescript", "@types/react", "@types/react-dom", "@types/node",
    "ts-node", "tsx", "esbuild", "tsup",
  ],
  "Linting / Formatting": [
    "eslint", "eslint-config-next", "prettier",
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
