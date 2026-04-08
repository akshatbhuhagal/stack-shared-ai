import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";
import {
  getProject,
  addSourceFile,
  extractExportedFunctions,
  extractExportedClasses,
} from "../../utils/ts-parser";

interface ApiEntry {
  kind: "function" | "class";
  name: string;
  signature: string;
  file: string;
}

function shortenType(t: string): string {
  // Trim long imported-type strings to keep signatures readable
  let s = t.replace(/import\("[^"]+"\)\./g, "");
  if (s.length > 50) s = s.slice(0, 47) + "...";
  return s;
}

export async function scanApi(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".tsx"],
  });

  if (files.length === 0) return null;

  const project = getProject(options.rootDir);
  const all: ApiEntry[] = [];

  for (const file of files) {
    if (file.endsWith(".d.ts")) continue;
    let sf;
    try {
      sf = addSourceFile(project, file);
    } catch {
      continue;
    }
    const rel = path.relative(options.rootDir, file).replace(/\\/g, "/");

    for (const fn of extractExportedFunctions(sf)) {
      const params = fn.params.map((p) => `${p.name}: ${shortenType(p.type)}`).join(", ");
      const sig = `${fn.isAsync ? "async " : ""}${fn.name}(${params}): ${shortenType(fn.returnType)}`;
      all.push({ kind: "function", name: fn.name, signature: sig, file: rel });
    }

    for (const cls of extractExportedClasses(sf)) {
      const ext = cls.extends ? ` extends ${cls.extends}` : "";
      const methodLines = cls.methods.map((m) => {
        const params = m.params.map((p) => `${p.name}: ${shortenType(p.type)}`).join(", ");
        return `  - ${m.isAsync ? "async " : ""}${m.name}(${params}): ${shortenType(m.returnType)}`;
      });
      const propLines = cls.properties.map((p) => `  - ${p.name}: ${shortenType(p.type)}`);
      const body = [...propLines, ...methodLines].join("\n");
      const sig = `class ${cls.name}${ext}${body ? "\n" + body : ""}`;
      all.push({ kind: "class", name: cls.name, signature: sig, file: rel });
    }
  }

  if (all.length === 0) return null;

  // Group by file
  const byFile: Record<string, ApiEntry[]> = {};
  for (const e of all) {
    if (!byFile[e.file]) byFile[e.file] = [];
    byFile[e.file].push(e);
  }

  const sections: string[] = [heading(1, "Public API")];

  for (const file of Object.keys(byFile).sort()) {
    const fns = byFile[file].filter((e) => e.kind === "function");
    const classes = byFile[file].filter((e) => e.kind === "class");

    const fileSection: string[] = [heading(3, `\`${file}\``)];
    if (fns.length > 0) {
      fileSection.push(bulletList(fns.sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.signature)));
    }
    if (classes.length > 0) {
      fileSection.push(classes.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.signature).join("\n\n"));
    }
    sections.push(joinSections(...fileSection));
  }

  return {
    filename: "api.md",
    content: sections.join("\n\n") + "\n",
  };
}
