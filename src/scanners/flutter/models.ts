import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import {
  getDartClasses,
  getDartEnums,
  DartClass,
  parseExtensionDeclarations,
  parseTypedefDeclarations,
  DartExtension,
  DartTypedef,
} from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Directory names that signal "this file holds a data model". Includes
// feature-based layouts (features/<name>/domain, features/<name>/data, etc.)
// via per-segment matching.
const MODEL_DIRS = [
  "models", "model",
  "entities", "entity",
  "data", "domain",
  "dtos", "dto",
  "types", "schema", "schemas",
];

function isModelDir(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => MODEL_DIRS.includes(p));
}

// Heuristic: even outside a model dir, a file with a freezed / json /
// hive class is almost certainly a model. This catches feature-based
// layouts that colocate model classes inline (features/auth/user.dart).
function looksLikeModelFile(content: string): boolean {
  return /@freezed\b|@JsonSerializable\b|@HiveType\b|part\s+['"][^'"]+\.freezed\.dart['"]|part\s+['"][^'"]+\.g\.dart['"]/.test(
    content,
  );
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

  interface ModelInfo {
    name: string;
    fields: string[];
    serialization: string | null;
    relativePath: string;
    modifiers?: string[];
  }

  interface SealedInfo {
    name: string;
    modifiers: string[];
    variants: string[]; // subclass names that extend/implement this sealed class
    relativePath: string;
  }

  const models: ModelInfo[] = [];
  const enums: { name: string; values: string[] }[] = [];
  const extensions: (DartExtension & { relativePath: string })[] = [];
  const typedefs: (DartTypedef & { relativePath: string })[] = [];
  const sealedClasses: SealedInfo[] = [];
  // All classes observed across model files — used to resolve sealed variants
  const allParsedClasses: DartClass[] = [];

  for (const filePath of dartFiles) {
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

    // Include file if it's in a model dir OR it carries model-like markers
    // (freezed, json_serializable, etc.) regardless of location.
    const inModelDir = isModelDir(filePath);
    if (!inModelDir && !looksLikeModelFile(content)) continue;

    const classes = getDartClasses(filePath, content);
    const relativePath = path.relative(options.rootDir, filePath).replace(/\\/g, "/");
    allParsedClasses.push(...classes);

    for (const cls of classes) {
      // Sealed classes are tracked separately so we can list their variants.
      if (cls.modifiers?.includes("sealed")) {
        sealedClasses.push({
          name: cls.name,
          modifiers: cls.modifiers,
          variants: [],
          relativePath,
        });
      }

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
      models.push({ name: cls.name, fields, serialization, relativePath, modifiers: cls.modifiers });
    }

    // Parse enums
    const fileEnums = getDartEnums(filePath, content);
    enums.push(...fileEnums);

    // Parse extensions and typedefs from this file
    for (const ext of parseExtensionDeclarations(content)) {
      extensions.push({ ...ext, relativePath });
    }
    for (const td of parseTypedefDeclarations(content)) {
      typedefs.push({ ...td, relativePath });
    }
  }

  // Resolve sealed class variants: any class whose extends/implements chain
  // references a sealed class we've seen is a variant of it.
  const sealedByName = new Map(sealedClasses.map((s) => [s.name, s]));
  for (const cls of allParsedClasses) {
    const parents: string[] = [];
    if (cls.superclass) parents.push(cls.superclass.split("<")[0].trim());
    // Check if any parent name matches a known sealed class
    for (const parent of parents) {
      const sealed = sealedByName.get(parent);
      if (sealed && !sealed.variants.includes(cls.name)) {
        sealed.variants.push(cls.name);
      }
    }
  }

  if (
    models.length === 0 &&
    enums.length === 0 &&
    extensions.length === 0 &&
    typedefs.length === 0 &&
    sealedClasses.length === 0
  ) return null;

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
      if (model.modifiers && model.modifiers.length > 0) {
        lines.push(`**Class:** ${model.modifiers.join(" ")} class`);
      }

      sections.push(joinSections(heading(2, model.name), bulletList(lines)));
    }
  }

  // Sealed class hierarchies — important for union-style state/event types.
  if (sealedClasses.length > 0) {
    const sealedLines = sealedClasses.map((s) => {
      const variants = s.variants.length > 0 ? s.variants.join(" | ") : "(no variants found)";
      const mods = s.modifiers.join(" ");
      return `${mods} ${s.name} → ${variants}  _(${s.relativePath})_`;
    });
    sections.push(joinSections(heading(2, "Sealed Classes"), bulletList(sealedLines)));
  }

  // Enums section
  if (enums.length > 0) {
    const enumLines = enums.map((e) => `${e.name}: ${e.values.join(", ")}`);
    sections.push(joinSections(heading(2, "Enums"), bulletList(enumLines)));
  }

  // Extensions section
  if (extensions.length > 0) {
    const extLines = extensions.map((e) => {
      const members = e.members.length > 0 ? ` { ${e.members.join(", ")} }` : "";
      return `${e.name} on ${e.on}${members}`;
    });
    sections.push(joinSections(heading(2, "Extensions"), bulletList(extLines)));
  }

  // Typedefs section
  if (typedefs.length > 0) {
    const tdLines = typedefs.map((t) => `${t.name} = ${t.value}`);
    sections.push(joinSections(heading(2, "Typedefs"), bulletList(tdLines)));
  }

  return {
    filename: "models.md",
    content: sections.join("\n\n") + "\n",
  };
}
