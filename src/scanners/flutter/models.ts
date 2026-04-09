import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses, getDartEnums, DartClass } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

const MODEL_DIRS = ["models", "model", "entities", "entity", "data", "domain"];

function isModelDir(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => MODEL_DIRS.includes(p));
}

function isModelClass(cls: DartClass): boolean {
  // Classes with serialization markers
  if (cls.annotations.some((a) => ["freezed", "JsonSerializable", "HiveType"].includes(a))) {
    return true;
  }
  // Classes with fromJson/toJson
  if (cls.methods.some((m) => m.name === "toJson" || m.name === "fromJson")) {
    return true;
  }
  // Classes with mostly final fields and no widget superclass
  const widgetTypes = ["StatelessWidget", "StatefulWidget", "State", "GetxController", "Cubit", "Bloc", "ChangeNotifier", "StateNotifier", "Notifier"];
  if (cls.superclass && widgetTypes.some((w) => cls.superclass!.includes(w))) {
    return false;
  }
  // If it has final fields and is in a model directory, count it
  if (cls.fields.filter((f) => f.isFinal).length >= 1) {
    return true;
  }
  return false;
}

function detectSerialization(cls: DartClass, fileContent: string): string | null {
  if (cls.annotations.includes("freezed")) return "@freezed (freezed + json_serializable)";
  if (cls.annotations.includes("JsonSerializable")) return "json_serializable";
  if (cls.annotations.includes("HiveType")) return "Hive";

  const hasFromJson = fileContent.includes(`${cls.name}.fromJson`) || cls.methods.some((m) => m.name === "fromJson");
  const hasToJson = cls.methods.some((m) => m.name === "toJson") || fileContent.includes("toJson()");

  if (hasFromJson && hasToJson) return "fromJson / toJson (manual)";
  if (hasFromJson) return "fromJson (manual)";
  if (hasToJson) return "toJson (manual)";

  return null;
}

export async function scanModels(options: ScanOptions): Promise<ScanResult | null> {
  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  });

  // Filter to model-related files
  const modelFiles = dartFiles.filter((f) => {
    if (isModelDir(f)) return true;
    // Also check files that aren't in model dirs but contain model-like classes
    return false;
  });

  if (modelFiles.length === 0) return null;

  interface ModelInfo {
    name: string;
    fields: string[];
    serialization: string | null;
    relativePath: string;
  }

  const models: ModelInfo[] = [];
  const enums: { name: string; values: string[] }[] = [];

  for (const filePath of modelFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Skip generated files
    if (content.includes("// GENERATED CODE") || filePath.endsWith(".g.dart") || filePath.endsWith(".freezed.dart")) {
      continue;
    }

    const classes = getDartClasses(filePath, content);
    const relativePath = path.relative(options.rootDir, filePath).replace(/\\/g, "/");

    for (const cls of classes) {
      if (!isModelClass(cls)) continue;

      const fields: string[] = [];

      // Prefer constructor params for field listing (more accurate for immutable models)
      if (cls.constructorParams.length > 0) {
        for (const param of cls.constructorParams) {
          const optionalMarker = !param.isRequired && !param.type.endsWith("?") ? "?" : "";
          const def = param.defaultValue ? ` = ${param.defaultValue}` : "";
          fields.push(`${param.name}: ${param.type}${optionalMarker}${def}`);
        }
      } else {
        for (const field of cls.fields) {
          const nullable = field.isNullable ? "" : "";
          const def = field.defaultValue ? ` = ${field.defaultValue}` : "";
          fields.push(`${field.name}: ${field.type}${def}`);
        }
      }

      const serialization = detectSerialization(cls, content);
      models.push({ name: cls.name, fields, serialization, relativePath });
    }

    // Parse enums
    const fileEnums = getDartEnums(filePath, content);
    enums.push(...fileEnums);
  }

  if (models.length === 0 && enums.length === 0) return null;

  // Build markdown
  const sections: string[] = [heading(1, "Models")];

  // Group models by directory
  const grouped: Record<string, ModelInfo[]> = {};
  for (const model of models) {
    const dir = path.dirname(model.relativePath);
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(model);
  }

  for (const [dir, dirModels] of Object.entries(grouped).sort()) {
    for (const model of dirModels) {
      const lines: string[] = [];
      for (const field of model.fields) {
        lines.push(field);
      }
      if (model.serialization) {
        lines.push(`**Serialization:** ${model.serialization}`);
      }

      sections.push(joinSections(heading(2, model.name), bulletList(lines)));
    }
  }

  // Enums section
  if (enums.length > 0) {
    const enumLines = enums.map((e) => `${e.name}: ${e.values.join(", ")}`);
    sections.push(joinSections(heading(2, "Enums"), bulletList(enumLines)));
  }

  return {
    filename: "models.md",
    content: sections.join("\n\n") + "\n",
  };
}
