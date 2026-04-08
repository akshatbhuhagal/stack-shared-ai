import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList, codeBlock } from "../../utils/markdown";

// Lightweight TOML section parser — extracts top-level [section] names and
// `key = value` pairs inside each. We don't need full TOML semantics.
interface BunfigSection {
  name: string;
  pairs: { key: string; value: string }[];
}

function parseBunfig(content: string): BunfigSection[] {
  const sections: BunfigSection[] = [];
  let current: BunfigSection = { name: "(root)", pairs: [] };
  for (const lineRaw of content.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      if (current.pairs.length > 0 || current.name === "(root)") sections.push(current);
      current = { name: sec[1], pairs: [] };
      continue;
    }
    const kv = line.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (kv) current.pairs.push({ key: kv[1], value: kv[2] });
  }
  if (current.pairs.length > 0) sections.push(current);
  return sections.filter((s) => !(s.name === "(root)" && s.pairs.length === 0));
}

export async function scanConfig(options: ScanOptions): Promise<ScanResult | null> {
  const bunfigPath = path.join(options.rootDir, "bunfig.toml");
  const hasBunfig = fs.existsSync(bunfigPath);

  // Also collect package.json scripts that use bun
  const pkgPath = path.join(options.rootDir, "package.json");
  let bunScripts: { name: string; cmd: string }[] = [];
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const scripts = (pkg.scripts ?? {}) as Record<string, string>;
      bunScripts = Object.entries(scripts)
        .filter(([, cmd]) => /\bbun\b/.test(cmd))
        .map(([name, cmd]) => ({ name, cmd }));
    } catch {
      // ignore
    }
  }

  if (!hasBunfig && bunScripts.length === 0) return null;

  const sections: string[] = [heading(1, "Bun Config")];

  if (hasBunfig) {
    let content: string;
    try {
      content = fs.readFileSync(bunfigPath, "utf-8");
    } catch {
      content = "";
    }
    sections.push("Source: `bunfig.toml`");
    const parsed = parseBunfig(content);
    if (parsed.length > 0) {
      for (const s of parsed) {
        const items = s.pairs.map((p) => `${p.key} = ${p.value}`);
        sections.push(joinSections(heading(3, `[${s.name}]`), items.length > 0 ? bulletList(items) : "_(empty)_"));
      }
    } else if (content.trim()) {
      sections.push(codeBlock(content.trim(), "toml"));
    }
  }

  if (bunScripts.length > 0) {
    sections.push(joinSections(
      heading(2, "Bun Scripts"),
      bulletList(bunScripts.map((s) => `${s.name}: \`${s.cmd}\``)),
    ));
  }

  return {
    filename: "config.md",
    content: sections.join("\n\n") + "\n",
  };
}
