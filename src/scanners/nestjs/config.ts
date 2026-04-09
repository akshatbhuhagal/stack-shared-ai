import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading } from "../../utils/markdown";
import { walkFiles } from "../../utils/file-walker";

interface EnvVar {
  name: string;
  comment?: string;
}

function parseEnvFile(content: string): EnvVar[] {
  const vars: EnvVar[] = [];
  let pendingComment = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      pendingComment = "";
      continue;
    }
    if (line.startsWith("#")) {
      pendingComment = line.replace(/^#+\s*/, "");
      continue;
    }
    const m = line.match(/^([A-Z0-9_]+)\s*=/);
    if (m) {
      vars.push({ name: m[1], comment: pendingComment || undefined });
      pendingComment = "";
    }
  }
  return vars;
}

export async function scanConfig(options: ScanOptions): Promise<ScanResult | null> {
  const sections: string[] = [heading(1, "Config")];
  let produced = false;

  // Look for .env example files at root
  const envCandidates = [".env.example", ".env.sample", ".env.template", ".env.local.example"];
  for (const name of envCandidates) {
    const p = path.join(options.rootDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const content = fs.readFileSync(p, "utf-8");
      const vars = parseEnvFile(content);
      if (vars.length > 0) {
        sections.push(heading(2, name));
        sections.push(
          vars
            .map((v) => (v.comment ? `- \`${v.name}\` — ${v.comment}` : `- \`${v.name}\``))
            .join("\n"),
        );
        produced = true;
      }
    } catch {
      // ignore
    }
  }

  // Scan code for ConfigModule.forRoot / forFeature calls and configService.get usages
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts"],
  }).filter((f) => !f.endsWith(".d.ts") && !f.endsWith(".spec.ts"));

  const forRootFlags: string[] = [];
  const envKeys: Set<string> = new Set();

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // ConfigModule.forRoot({ ... })
    const forRootRe = /ConfigModule\.forRoot\s*\(\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = forRootRe.exec(content)) !== null) {
      const inner = m[1];
      const flags = inner
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("//"));
      forRootFlags.push(...flags);
    }

    // configService.get<T>('KEY') / .get('KEY')
    const getRe = /configService\.get(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = getRe.exec(content)) !== null) {
      envKeys.add(m[1]);
    }

    // process.env.X
    const procEnvRe = /process\.env\.([A-Z0-9_]+)/g;
    while ((m = procEnvRe.exec(content)) !== null) {
      envKeys.add(m[1]);
    }
  }

  if (forRootFlags.length > 0) {
    sections.push(heading(2, "ConfigModule.forRoot"));
    sections.push([...new Set(forRootFlags)].map((f) => `- ${f}`).join("\n"));
    produced = true;
  }

  if (envKeys.size > 0) {
    sections.push(heading(2, "Env keys referenced in code"));
    sections.push([...envKeys].sort().map((k) => `- \`${k}\``).join("\n"));
    produced = true;
  }

  if (!produced) return null;

  return {
    filename: "config.md",
    content: sections.join("\n\n") + "\n",
  };
}
