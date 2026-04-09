import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading } from "../../utils/markdown";
import { walkFiles } from "../../utils/file-walker";

interface ProviderInfo {
  name: string;
  file: string;
  methods: string[];
}

export async function scanProviders(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts"],
  }).filter((f) => !f.endsWith(".d.ts") && !f.endsWith(".spec.ts") && !f.endsWith(".test.ts"));

  const providers: ProviderInfo[] = [];
  // Skip controllers — they have their own file
  const re = /@Injectable\s*\(\s*\)?\s*\)?\s*export\s+class\s+(\w+)/g;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!content.includes("@Injectable")) continue;

    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      // Find class body
      const classStart = content.indexOf("{", m.index + m[0].length);
      if (classStart === -1) continue;
      let depth = 1;
      let i = classStart + 1;
      while (i < content.length && depth > 0) {
        const c = content[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth === 0) break;
        i++;
      }
      const body = content.slice(classStart + 1, i);

      // Extract public methods (skip private/protected/constructor)
      const methods: string[] = [];
      const methodRe = /(?:^|\n)\s*(?!private|protected|constructor)(?:public\s+)?(?:async\s+)?(\w+)\s*\(/g;
      let mm: RegExpExecArray | null;
      while ((mm = methodRe.exec(body)) !== null) {
        const mname = mm[1];
        if (["if", "for", "while", "switch", "return", "catch", "super", "this"].includes(mname)) continue;
        if (mname.startsWith("_")) continue;

        // Walk balanced parens for params
        const parenStart = mm.index + mm[0].length;
        let depth = 1;
        let j = parenStart;
        while (j < body.length && depth > 0) {
          if (body[j] === "(") depth++;
          else if (body[j] === ")") depth--;
          if (depth === 0) break;
          j++;
        }
        const params = body.slice(parenStart, j).trim().replace(/\s+/g, " ");
        j++; // past )
        // Skip whitespace, optional `: <type>` walking balanced <>/{}
        while (j < body.length && /\s/.test(body[j])) j++;
        let ret = "";
        if (body[j] === ":") {
          j++;
          while (j < body.length && /\s/.test(body[j])) j++;
          const retStart = j;
          let angle = 0, brace = 0, paren = 0;
          while (j < body.length) {
            const c = body[j];
            if (c === "<") angle++;
            else if (c === ">") angle--;
            else if (c === "{") {
              if (angle === 0 && paren === 0 && brace === 0) break;
              brace++;
            } else if (c === "}") brace--;
            else if (c === "(") paren++;
            else if (c === ")") paren--;
            else if (c === ";" && angle === 0 && paren === 0 && brace === 0) break;
            j++;
          }
          ret = body.slice(retStart, j).trim();
        }

        const sig = `${mname}(${params})${ret ? ": " + ret : ""}`;
        methods.push(sig.length > 100 ? sig.slice(0, 100) + "…" : sig);
      }

      providers.push({
        name,
        file: path.relative(options.rootDir, file).replace(/\\/g, "/"),
        methods,
      });
    }
  }

  if (providers.length === 0) return null;

  // Skip controllers (those ending with "Controller") — they're in controllers.md
  const filtered = providers.filter((p) => !p.name.endsWith("Controller"));
  if (filtered.length === 0) return null;

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  // Group by directory
  const byDir: Map<string, ProviderInfo[]> = new Map();
  for (const p of filtered) {
    const dir = path.dirname(p.file);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(p);
  }

  const sections: string[] = [heading(1, "Providers")];
  const sortedDirs = Array.from(byDir.keys()).sort();
  for (const dir of sortedDirs) {
    sections.push(heading(2, dir));
    for (const p of byDir.get(dir)!) {
      sections.push(`**${p.name}** _(${path.basename(p.file)})_`);
      if (p.methods.length > 0) {
        sections.push(p.methods.map((m) => `- ${m}`).join("\n"));
      }
    }
  }

  return {
    filename: "providers.md",
    content: sections.join("\n\n") + "\n",
  };
}
