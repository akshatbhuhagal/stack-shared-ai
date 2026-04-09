import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses, DartClass } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const WIDGET_DIRS = ["widgets", "widget", "components", "component", "common", "shared", "ui"];
const SCREEN_DIRS = ["screens", "screen", "pages", "page", "views", "view"];
const SCREEN_SUFFIXES = ["Screen", "Page", "View"];

function isWidgetDir(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => WIDGET_DIRS.includes(p));
}

function isScreenDir(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => SCREEN_DIRS.includes(p));
}

function isWidget(cls: DartClass): boolean {
  if (!cls.superclass) return false;
  return cls.superclass.includes("StatelessWidget") || cls.superclass.includes("StatefulWidget");
}

function isScreen(cls: DartClass, filePath: string): boolean {
  if (isScreenDir(filePath)) return true;
  return SCREEN_SUFFIXES.some((suffix) => cls.name.endsWith(suffix));
}

function formatParam(param: { name: string; type: string; isRequired: boolean; defaultValue?: string }): string {
  const parts: string[] = [];
  parts.push(`${param.name}: ${param.type}`);
  if (param.defaultValue) {
    parts[parts.length - 1] += ` = ${param.defaultValue}`;
  }
  return parts.join("");
}

export async function scanComponents(options: ScanOptions): Promise<ScanResult | null> {
  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  });

  interface WidgetInfo {
    name: string;
    params: string;
    relativePath: string;
    dir: string;
  }

  const widgets: WidgetInfo[] = [];

  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (content.includes("// GENERATED CODE") || filePath.endsWith(".g.dart") || filePath.endsWith(".freezed.dart")) {
      continue;
    }

    const classes = getDartClasses(filePath, content);
    const relativePath = path.relative(options.rootDir, filePath).replace(/\\/g, "/");

    for (const cls of classes) {
      if (!isWidget(cls)) continue;
      if (isScreen(cls, filePath)) continue;

      // Only include if in widget-like dirs or if not in screen dirs
      if (!isWidgetDir(filePath) && isScreenDir(filePath)) continue;

      const params = cls.constructorParams
        .filter((p) => p.name !== "key")
        .map(formatParam)
        .join(", ");

      const dir = path.dirname(relativePath);
      widgets.push({ name: cls.name, params, relativePath, dir });
    }
  }

  if (widgets.length === 0) return null;

  // Group by directory
  const grouped: Record<string, WidgetInfo[]> = {};
  for (const w of widgets) {
    if (!grouped[w.dir]) grouped[w.dir] = [];
    grouped[w.dir].push(w);
  }

  const sections: string[] = [heading(1, "Components")];

  for (const [dir, dirWidgets] of Object.entries(grouped).sort()) {
    const displayDir = dir || "(root)";
    const items = dirWidgets.map((w) => {
      return w.params ? `${w.name}(${w.params})` : w.name;
    });
    sections.push(joinSections(heading(2, displayDir), bulletList(items)));
  }

  return {
    filename: "components.md",
    content: sections.join("\n\n") + "\n",
  };
}
