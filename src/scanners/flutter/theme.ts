import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Theme scanner — surfaces design-system definitions so AI assistants can
// match the app's visual language when generating UI. Looks for:
//   * ThemeData.light/dark builders and inline ThemeData() expressions
//   * ColorScheme / ColorScheme.fromSeed usage
//   * TextTheme field assignments
//   * Custom ThemeExtension<T> subclasses
//   * Standalone Color constants (top-level or in AppColors-style classes)

const THEME_DIRS = ["theme", "themes", "styles", "style", "design", "design_system", "core"];
const THEME_FILENAMES = ["theme.dart", "app_theme.dart", "themes.dart", "colors.dart", "app_colors.dart", "styles.dart", "text_styles.dart", "typography.dart"];

function looksLikeThemeFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  const base = path.basename(norm);
  if (THEME_FILENAMES.includes(base)) return true;
  return norm.split("/").some((p) => THEME_DIRS.includes(p.toLowerCase()));
}

// Pull the argument list from the first balanced `(...)` following `marker`.
function extractCallArgs(content: string, marker: RegExp): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(marker.source, marker.flags.includes("g") ? marker.flags : marker.flags + "g");
  while ((m = re.exec(content)) !== null) {
    const start = m.index + m[0].length;
    // Find matching close paren
    let depth = 0;
    let i = start;
    if (content[i - 1] !== "(") continue;
    depth = 1;
    for (; i < content.length && depth > 0; i++) {
      const c = content[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    if (depth === 0) matches.push(content.slice(start, i - 1));
  }
  return matches;
}

interface ThemeFacts {
  file: string;
  themeDataBuilders: string[]; // e.g. "lightTheme", "darkTheme"
  colorSchemeSeeds: string[]; // seed colors from ColorScheme.fromSeed
  brightnessHints: string[]; // "light" | "dark"
  primaryColors: string[]; // values assigned to primaryColor / primary
}

function extractThemeFacts(filePath: string, content: string): ThemeFacts | null {
  const facts: ThemeFacts = {
    file: filePath,
    themeDataBuilders: [],
    colorSchemeSeeds: [],
    brightnessHints: [],
    primaryColors: [],
  };

  // ThemeData() and ThemeData.light()/dark() calls
  if (!/ThemeData\b/.test(content)) {
    // still allow files that only export colors/text styles
  }

  // Detect getter/variable names that return ThemeData
  const builderRe = /(?:ThemeData\s+)?(?:get\s+)?(\w+)\s*(?:\([^)]*\))?\s*(?:=>|{\s*return)\s*ThemeData/g;
  let bm: RegExpExecArray | null;
  while ((bm = builderRe.exec(content)) !== null) {
    if (!facts.themeDataBuilders.includes(bm[1])) facts.themeDataBuilders.push(bm[1]);
  }

  // ColorScheme.fromSeed(seedColor: ...)
  const seedMatches = extractCallArgs(content, /ColorScheme\.fromSeed\s*\(/);
  for (const args of seedMatches) {
    const seedMatch = /seedColor\s*:\s*([^,)]+)/.exec(args);
    if (seedMatch) {
      const seed = seedMatch[1].trim();
      if (!facts.colorSchemeSeeds.includes(seed)) facts.colorSchemeSeeds.push(seed);
    }
  }

  // brightness: Brightness.light / Brightness.dark
  const brightnessRe = /brightness\s*:\s*Brightness\.(light|dark)/g;
  let br: RegExpExecArray | null;
  while ((br = brightnessRe.exec(content)) !== null) {
    if (!facts.brightnessHints.includes(br[1])) facts.brightnessHints.push(br[1]);
  }

  // primaryColor: <value>
  const primaryRe = /primaryColor\s*:\s*([^,)\n]+)/g;
  let pm: RegExpExecArray | null;
  while ((pm = primaryRe.exec(content)) !== null) {
    const val = pm[1].trim();
    if (!facts.primaryColors.includes(val)) facts.primaryColors.push(val);
  }

  const hasAnything =
    facts.themeDataBuilders.length > 0 ||
    facts.colorSchemeSeeds.length > 0 ||
    facts.brightnessHints.length > 0 ||
    facts.primaryColors.length > 0 ||
    /ThemeData\b/.test(content);
  return hasAnything ? facts : null;
}

interface ColorConstant {
  name: string;
  value: string;
  className: string | null;
}

// Top-level `const Color x = Color(0xFF...)` and class-level static const Color fields.
function extractColorConstants(content: string, filePath: string): ColorConstant[] {
  const out: ColorConstant[] = [];

  // static const Color name = ...;
  const classRe = /class\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(content)) !== null) {
    const className = cm[1];
    const body = cm[2];
    const fieldRe = /static\s+const\s+Color\s+(\w+)\s*=\s*(Color[^;]*?|const\s+Color[^;]*?);/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      out.push({ name: fm[1], value: fm[2].trim(), className });
    }
  }

  // Top-level const Color name = Color(...);
  const topRe = /(?:^|\n)\s*const\s+Color\s+(\w+)\s*=\s*(Color[^;]*?);/g;
  let tm: RegExpExecArray | null;
  while ((tm = topRe.exec(content)) !== null) {
    out.push({ name: tm[1], value: tm[2].trim(), className: null });
  }

  return out;
}

export async function scanTheme(options: ScanOptions): Promise<ScanResult | null> {
  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  }).filter(
    (f) => !f.endsWith(".g.dart") && !f.endsWith(".freezed.dart"),
  );

  const themeFiles = dartFiles.filter(looksLikeThemeFile);
  if (themeFiles.length === 0) return null;

  const allFacts: ThemeFacts[] = [];
  const allColors: ColorConstant[] = [];
  const themeExtensions: { name: string; file: string }[] = [];

  for (const filePath of themeFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const facts = extractThemeFacts(filePath, content);
    if (facts) allFacts.push(facts);

    const colors = extractColorConstants(content, filePath);
    allColors.push(...colors);

    // Custom theme extensions — `extends ThemeExtension<MyExt>`
    const classes = getDartClasses(filePath, content);
    for (const cls of classes) {
      if (cls.superclass && /ThemeExtension\s*<\s*\w+\s*>/.test(cls.superclass)) {
        themeExtensions.push({
          name: cls.name,
          file: path.relative(options.rootDir, filePath).replace(/\\/g, "/"),
        });
      }
    }
  }

  if (allFacts.length === 0 && allColors.length === 0 && themeExtensions.length === 0) {
    return null;
  }

  const sections: string[] = [heading(1, "Theme")];

  // Theme files + builders
  if (allFacts.length > 0) {
    const lines: string[] = [];
    for (const f of allFacts) {
      const rel = path.relative(options.rootDir, f.file).replace(/\\/g, "/");
      const parts: string[] = [rel];
      if (f.themeDataBuilders.length > 0) parts.push(`builders: ${f.themeDataBuilders.join(", ")}`);
      if (f.brightnessHints.length > 0) parts.push(`brightness: ${f.brightnessHints.join(", ")}`);
      if (f.colorSchemeSeeds.length > 0) parts.push(`seedColor: ${f.colorSchemeSeeds.join(", ")}`);
      if (f.primaryColors.length > 0) parts.push(`primaryColor: ${f.primaryColors.join(", ")}`);
      lines.push(parts.join(" — "));
    }
    sections.push(joinSections(heading(2, "Theme Files"), bulletList(lines)));
  }

  // Color constants
  if (allColors.length > 0) {
    const byClass: Record<string, ColorConstant[]> = {};
    for (const c of allColors) {
      const key = c.className ?? "(top-level)";
      if (!byClass[key]) byClass[key] = [];
      byClass[key].push(c);
    }
    const colorSections: string[] = [heading(2, "Colors")];
    for (const [cls, colors] of Object.entries(byClass).sort()) {
      const lines = colors.map((c) => `${c.name}: ${c.value}`);
      colorSections.push(joinSections(heading(3, cls), bulletList(lines)));
    }
    sections.push(colorSections.join("\n\n"));
  }

  // Theme extensions
  if (themeExtensions.length > 0) {
    const lines = themeExtensions.map((e) => `${e.name} — ${e.file}`);
    sections.push(joinSections(heading(2, "Theme Extensions"), bulletList(lines)));
  }

  return {
    filename: "theme.md",
    content: sections.join("\n\n") + "\n",
  };
}
