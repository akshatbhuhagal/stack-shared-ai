import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getProject, addSourceFile, extractExportedFunctions, extractExportedClasses, ExportedFunction } from "../../utils/ts-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const SERVICE_DIRS = ["services", "service", "controllers", "controller", "lib", "usecases", "use-cases", "domain", "handlers"];

function isServiceFile(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => SERVICE_DIRS.includes(p));
}

function formatFn(fn: ExportedFunction): string {
  const params = fn.params.map((p) => p.name).join(", ");
  const asyncMarker = fn.isAsync ? " (async)" : "";
  // Simplify return type — strip Promise<>, long inferred types
  let ret = fn.returnType;
  const promiseMatch = ret.match(/^Promise<(.+)>$/);
  if (promiseMatch) ret = promiseMatch[1];
  if (ret.length > 40) ret = ret.substring(0, 37) + "...";
  return `${fn.name}(${params})${ret && ret !== "void" ? ` → ${ret}` : ""}${asyncMarker}`;
}

export async function scanServices(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts", ".js", ".mjs"],
  });

  const serviceFiles = files.filter(isServiceFile);
  if (serviceFiles.length === 0) return null;

  const project = getProject(options.rootDir);

  interface ServiceEntry {
    file: string;
    relativePath: string;
    functions: ExportedFunction[];
    classes: { name: string; methods: string[] }[];
  }

  const entries: ServiceEntry[] = [];

  for (const file of serviceFiles) {
    try {
      const sourceFile = addSourceFile(project, file);
      const functions = extractExportedFunctions(sourceFile);
      const classesRaw = extractExportedClasses(sourceFile);

      const classes = classesRaw.map((c) => ({
        name: c.name,
        methods: c.methods.map(formatFn),
      }));

      if (functions.length === 0 && classes.length === 0) continue;

      entries.push({
        file,
        relativePath: path.relative(options.rootDir, file).replace(/\\/g, "/"),
        functions,
        classes,
      });
    } catch {
      continue;
    }
  }

  if (entries.length === 0) return null;

  // Group by directory
  const grouped: Record<string, ServiceEntry[]> = {};
  for (const entry of entries) {
    const dir = path.dirname(entry.relativePath);
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(entry);
  }

  const sections: string[] = [heading(1, "Services")];

  for (const [dir, dirEntries] of Object.entries(grouped).sort()) {
    sections.push(heading(2, dir));

    for (const entry of dirEntries) {
      const fileLabel = path.basename(entry.relativePath);
      const lines: string[] = [];

      for (const fn of entry.functions) {
        lines.push(formatFn(fn));
      }

      for (const cls of entry.classes) {
        lines.push(`**${cls.name}:** ${cls.methods.join(", ")}`);
      }

      if (lines.length > 0) {
        sections.push(joinSections(heading(3, fileLabel), bulletList(lines)));
      }
    }
  }

  return {
    filename: "services.md",
    content: sections.join("\n\n") + "\n",
  };
}
