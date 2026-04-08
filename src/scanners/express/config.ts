import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

interface EnvVar {
  name: string;
  comment?: string;
  defaultValue?: string;
}

function parseEnvFile(content: string): EnvVar[] {
  const vars: EnvVar[] = [];
  const lines = content.split("\n");
  let pendingComment: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComment = undefined;
      continue;
    }

    if (trimmed.startsWith("#")) {
      pendingComment = trimmed.replace(/^#\s*/, "");
      continue;
    }

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const name = match[1];
      const rawValue = match[2].trim().replace(/^['"]|['"]$/g, "");
      vars.push({
        name,
        comment: pendingComment,
        defaultValue: rawValue || undefined,
      });
      pendingComment = undefined;
    }
  }

  return vars;
}

function findProcessEnvUsages(files: string[]): Set<string> {
  const found = new Set<string>();
  const regex = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    let match;
    while ((match = regex.exec(content)) !== null) {
      found.add(match[1]);
    }
  }

  return found;
}

export async function scanConfig(options: ScanOptions): Promise<ScanResult | null> {
  const rootDir = options.rootDir;

  // Look for .env.example / .env.sample / .env.template
  const envCandidates = [".env.example", ".env.sample", ".env.template", ".env.dist", ".env"];
  let envVars: EnvVar[] = [];
  let envSource: string | null = null;

  for (const candidate of envCandidates) {
    const p = path.join(rootDir, candidate);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      envVars = parseEnvFile(content);
      envSource = candidate;
      if (envVars.length > 0) break;
    }
  }

  // Scan code for additional process.env.X usages
  const files = walkFiles(rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".js", ".mjs", ".cjs"],
  });

  const usedVars = findProcessEnvUsages(files);

  // Merge: vars declared in .env.example + any used in code but not declared
  const declaredNames = new Set(envVars.map((v) => v.name));
  for (const used of usedVars) {
    if (!declaredNames.has(used)) {
      envVars.push({ name: used, comment: "(used in code, not in .env.example)" });
    }
  }

  if (envVars.length === 0) return null;

  const sections: string[] = [heading(1, "Configuration")];

  if (envSource) {
    sections.push(`**Source:** \`${envSource}\``);
  }

  const items = envVars.map((v) => {
    const parts = [v.name];
    if (v.defaultValue) parts.push(`= ${v.defaultValue}`);
    if (v.comment) parts.push(`— ${v.comment}`);
    return parts.join(" ");
  });

  sections.push(joinSections(heading(2, "Environment Variables"), bulletList(items)));

  return {
    filename: "config.md",
    content: sections.join("\n\n") + "\n",
  };
}
