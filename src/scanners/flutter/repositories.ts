import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses, DartClass, DartMethod } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Repository scanner — surfaces the data abstraction layer between the
// UI/state and the raw API/DB. AI assistants need this because:
//   * fetching data belongs here, not in notifiers or widgets
//   * the method shapes are the contract the rest of the app calls
//
// Detection strategy (any of these counts):
//   1. Class name ends with "Repository" / "Repo"
//   2. File sits in a repositories/ or data/repositories/ directory
//   3. Class is abstract + matches one of the above suffix/name patterns
//
// For each repository we emit:
//   * the class name
//   * whether it's abstract (the contract) or concrete (the implementation)
//   * public method signatures (so callers know the API surface)

interface RepositoryInfo {
  name: string;
  isAbstract: boolean;
  methods: string[];
  relativePath: string;
  superclass?: string;
  implementedBy?: string[]; // populated for abstract classes
}

const REPO_DIRS = ["repositories", "repository", "repo", "repos"];

function inRepoDir(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => REPO_DIRS.includes(p));
}

function looksLikeRepositoryName(name: string): boolean {
  return /Repository$|Repo$/.test(name);
}

function formatMethod(m: DartMethod): string {
  const params = m.params
    .filter((p) => p.name !== "key")
    .map((p) => `${p.name}: ${p.type}`)
    .join(", ");
  const asyncStr = m.isAsync ? " async" : "";
  return `${m.name}(${params}) → ${m.returnType}${asyncStr}`;
}

export async function scanRepositories(options: ScanOptions): Promise<ScanResult | null> {
  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  }).filter((f) => !f.endsWith(".g.dart") && !f.endsWith(".freezed.dart"));

  const repos: RepositoryInfo[] = [];

  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const classes = getDartClasses(filePath, content);
    const relativePath = path.relative(options.rootDir, filePath).replace(/\\/g, "/");
    const fileInRepoDir = inRepoDir(filePath);

    for (const cls of classes) {
      const nameMatches = looksLikeRepositoryName(cls.name);
      if (!nameMatches && !fileInRepoDir) continue;
      // Inside a repo dir but the class isn't a repository — skip helpers
      if (!nameMatches && fileInRepoDir && !/Repository|Repo|DataSource/.test(cls.name)) continue;

      const isAbstract = cls.modifiers?.includes("abstract") ?? false;

      const methods = cls.methods
        .filter((m) => !m.name.startsWith("_"))
        .map(formatMethod);

      repos.push({
        name: cls.name,
        isAbstract,
        methods,
        relativePath,
        superclass: cls.superclass,
      });
    }
  }

  // Link implementations to their abstract contracts
  for (const repo of repos) {
    if (!repo.isAbstract) continue;
    const impls = repos
      .filter((r) => !r.isAbstract && r.superclass && r.superclass.split("<")[0].trim() === repo.name)
      .map((r) => r.name);
    if (impls.length > 0) repo.implementedBy = impls;
  }

  if (repos.length === 0) return null;

  // Group by directory for stable output
  const grouped: Record<string, RepositoryInfo[]> = {};
  for (const r of repos) {
    const dir = path.dirname(r.relativePath);
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(r);
  }

  const sections: string[] = [heading(1, "Repositories")];

  for (const [dir, dirRepos] of Object.entries(grouped).sort()) {
    sections.push(heading(2, dir));
    for (const repo of dirRepos) {
      const header = repo.isAbstract ? `${repo.name} (abstract)` : repo.name;
      const lines: string[] = [];
      if (repo.isAbstract && repo.implementedBy && repo.implementedBy.length > 0) {
        lines.push(`**Implemented by:** ${repo.implementedBy.join(", ")}`);
      } else if (!repo.isAbstract && repo.superclass) {
        lines.push(`**Implements:** ${repo.superclass}`);
      }
      if (repo.methods.length > 0) {
        for (const m of repo.methods) lines.push(m);
      } else {
        lines.push("_(no public methods detected)_");
      }
      sections.push(joinSections(heading(3, header), bulletList(lines)));
    }
  }

  return {
    filename: "repositories.md",
    content: sections.join("\n\n") + "\n",
  };
}
