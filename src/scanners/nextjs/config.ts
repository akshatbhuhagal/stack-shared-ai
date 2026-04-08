import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList, codeBlock } from "../../utils/markdown";

const CONFIG_NAMES = [
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
];

function findNextConfig(rootDir: string): string | null {
  for (const n of CONFIG_NAMES) {
    const full = path.join(rootDir, n);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function extractScalarKey(content: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*:\\s*([^,\\n}]+)`);
  const m = content.match(re);
  return m ? m[1].trim().replace(/[,;]+$/, "") : null;
}

function extractStringArray(content: string, key: string): string[] {
  const re = new RegExp(`\\b${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`);
  const m = content.match(re);
  if (!m) return [];
  const out: string[] = [];
  const sre = /['"`]([^'"`]+)['"`]/g;
  let s;
  while ((s = sre.exec(m[1])) !== null) out.push(s[1]);
  return out;
}

function extractEnvFiles(rootDir: string): { file: string; vars: { name: string; comment?: string }[] }[] {
  const candidates = [".env.example", ".env.sample", ".env.template", ".env.local.example"];
  const out: { file: string; vars: { name: string; comment?: string }[] }[] = [];
  for (const c of candidates) {
    const full = path.join(rootDir, c);
    if (!fs.existsSync(full)) continue;
    let content: string;
    try {
      content = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const vars: { name: string; comment?: string }[] = [];
    let lastComment: string | undefined;
    for (const lineRaw of content.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line) { lastComment = undefined; continue; }
      if (line.startsWith("#")) {
        lastComment = line.replace(/^#\s*/, "");
        continue;
      }
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
      if (m) {
        vars.push({ name: m[1], comment: lastComment });
        lastComment = undefined;
      }
    }
    if (vars.length > 0) out.push({ file: c, vars });
  }
  return out;
}

export async function scanConfig(options: ScanOptions): Promise<ScanResult | null> {
  const configFile = findNextConfig(options.rootDir);
  const envFiles = extractEnvFiles(options.rootDir);
  if (!configFile && envFiles.length === 0) return null;

  const sections: string[] = [heading(1, "Next.js Config")];

  if (configFile) {
    let content: string;
    try {
      content = fs.readFileSync(configFile, "utf-8");
    } catch {
      content = "";
    }
    const rel = path.relative(options.rootDir, configFile).replace(/\\/g, "/");
    sections.push(`Source: \`${rel}\``);

    const highlights: string[] = [];
    for (const k of ["reactStrictMode", "swcMinify", "basePath", "assetPrefix", "output", "trailingSlash", "poweredByHeader"]) {
      const v = extractScalarKey(content, k);
      if (v) highlights.push(`${k}: ${v}`);
    }
    const imageDomains = extractStringArray(content, "domains");
    if (imageDomains.length > 0) highlights.push(`images.domains: ${imageDomains.join(", ")}`);

    const remotePatterns = extractStringArray(content, "remotePatterns");
    if (remotePatterns.length > 0) highlights.push(`images.remotePatterns: ${remotePatterns.length} pattern(s)`);

    if (highlights.length > 0) {
      sections.push(joinSections(heading(2, "Highlights"), bulletList(highlights)));
    }

    // Experimental block (top-level keys only)
    const expMatch = content.match(/experimental\s*:\s*\{([\s\S]*?)\}/);
    if (expMatch) {
      const expKeys: string[] = [];
      const keyRe = /(\w+)\s*:/g;
      let m;
      while ((m = keyRe.exec(expMatch[1])) !== null) expKeys.push(m[1]);
      if (expKeys.length > 0) {
        sections.push(joinSections(heading(2, "Experimental flags"), bulletList(expKeys)));
      }
    }
  }

  if (envFiles.length > 0) {
    sections.push(heading(2, "Environment Variables"));
    for (const ef of envFiles) {
      const lines = ef.vars.map((v) =>
        v.comment ? `${v.name} — ${v.comment}` : v.name,
      );
      sections.push(joinSections(heading(3, `\`${ef.file}\``), bulletList(lines)));
    }
  }

  return {
    filename: "config.md",
    content: sections.join("\n\n") + "\n",
  };
}
