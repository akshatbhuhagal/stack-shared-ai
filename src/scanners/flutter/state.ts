import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { getDartClasses, DartClass, DartField, DartMethod } from "../../utils/dart-parser";
import { heading, joinSections, bulletList } from "../../utils/markdown";

type StatePackage = "riverpod" | "bloc" | "getx" | "provider" | "mobx" | "unknown";

function detectStatePackage(rootDir: string): StatePackage {
  const pubspecPath = path.join(rootDir, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return "unknown";
  try {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    const pubspec = parseYaml(content) as Record<string, unknown>;
    const deps = { ...(pubspec.dependencies as Record<string, unknown> ?? {}), ...(pubspec.dev_dependencies as Record<string, unknown> ?? {}) };
    if (deps.flutter_riverpod || deps.riverpod || deps.hooks_riverpod) return "riverpod";
    if (deps.flutter_bloc || deps.bloc) return "bloc";
    if (deps.get || deps.getx) return "getx";
    if (deps.provider) return "provider";
    if (deps.flutter_mobx || deps.mobx) return "mobx";
    return "unknown";
  } catch {
    return "unknown";
  }
}

interface StateEntry {
  className: string;
  type: string; // e.g. "StateNotifier<AuthState>", "Cubit<int>"
  providerName?: string;
  stateFields: string[];
  methods: string[];
  // Shape of the associated state class, if one was found
  stateShape?: {
    name: string;
    fields: string[];
    variants?: string[]; // sealed/union variants (e.g. Initial | Authenticated | Error)
  };
}

// Find a state-shape class by name across all parsed classes in the project.
// Also collects sealed class variants: any class whose extends/implements/with
// chain references the given name.
function findStateShape(
  name: string,
  allClasses: DartClass[],
): StateEntry["stateShape"] | undefined {
  const shape = allClasses.find((c) => c.name === name);
  if (!shape) return undefined;

  const fields = shape.constructorParams.length > 0
    ? shape.constructorParams.map((p) => `${p.name}: ${p.type}`)
    : shape.fields.map((f) => `${f.name}: ${f.type}`);

  // Collect variants (for sealed / freezed union types)
  const variants: string[] = [];
  for (const cls of allClasses) {
    const parents: string[] = [];
    if (cls.superclass) parents.push(cls.superclass.split("<")[0].trim());
    if (parents.includes(name) && cls.name !== name) {
      variants.push(cls.name);
    }
  }

  return {
    name,
    fields,
    variants: variants.length > 0 ? variants : undefined,
  };
}

// --- Riverpod ---

function parseRiverpodProviders(
  content: string,
  classes: DartClass[],
  allClasses: DartClass[],
): StateEntry[] {
  const entries: StateEntry[] = [];

  // Match provider declarations: final xxxProvider = StateNotifierProvider<...>(...)
  const providerRegex = /final\s+(\w+)\s*=\s*(StateNotifierProvider|NotifierProvider|StateProvider|FutureProvider|StreamProvider|Provider|ChangeNotifierProvider|AsyncNotifierProvider)(?:<([^>]+)>)?\s*\(/g;
  let match;

  while ((match = providerRegex.exec(content)) !== null) {
    const providerName = match[1];
    const providerType = match[2];
    const typeArgs = match[3] || "";

    // Try to find the notifier class (first type arg) and state class (second)
    const typeArgList = typeArgs.split(",").map((s) => s.trim());
    const notifierName = typeArgList[0];
    const stateName = typeArgList[1];
    const cls = classes.find((c) => c.name === notifierName);

    const entry: StateEntry = {
      className: notifierName || providerName,
      type: `${providerType}${typeArgs ? `<${typeArgs}>` : ""}`,
      providerName,
      stateFields: [],
      methods: [],
    };

    if (cls) {
      entry.stateFields = cls.fields.map((f) => `${f.name} (${f.type})`);
      entry.methods = cls.methods
        .filter((m) => !m.name.startsWith("_"))
        .map((m) => formatMethod(m));
    }

    if (stateName) {
      entry.stateShape = findStateShape(stateName, allClasses);
    }

    entries.push(entry);
  }

  // Also look for @riverpod annotation (code generation)
  for (const cls of classes) {
    if (cls.annotations.includes("riverpod")) {
      const entry: StateEntry = {
        className: cls.name,
        type: "@riverpod",
        providerName: camelCase(cls.name) + "Provider",
        stateFields: cls.fields.map((f) => `${f.name} (${f.type})`),
        methods: cls.methods
          .filter((m) => !m.name.startsWith("_") && m.name !== "build")
          .map((m) => formatMethod(m)),
      };
      entries.push(entry);
    }
  }

  return entries;
}

// --- Bloc ---

function parseBlocClasses(classes: DartClass[], allClasses: DartClass[]): StateEntry[] {
  const entries: StateEntry[] = [];

  for (const cls of classes) {
    if (!cls.superclass) continue;

    const isBlocOrCubit = cls.superclass.includes("Bloc<") || cls.superclass.includes("Cubit<");
    if (!isBlocOrCubit) continue;

    // Extract type args: Bloc<AuthEvent, AuthState> or Cubit<AuthState>
    const targsMatch = cls.superclass.match(/<([^>]+)>/);
    const typeArgs = targsMatch ? targsMatch[1].split(",").map((s) => s.trim()) : [];
    // For Bloc<Event, State> the state is the second arg; for Cubit<State> it's the first.
    const isBloc = cls.superclass.includes("Bloc<");
    const stateName = isBloc ? typeArgs[1] : typeArgs[0];

    const entry: StateEntry = {
      className: cls.name,
      type: cls.superclass,
      stateFields: cls.fields.map((f) => `${f.name} (${f.type})`),
      methods: cls.methods
        .filter((m) => !m.name.startsWith("_"))
        .map((m) => formatMethod(m)),
    };

    if (stateName) {
      entry.stateShape = findStateShape(stateName, allClasses);
    }

    entries.push(entry);
  }

  return entries;
}

// --- GetX ---

function parseGetXControllers(classes: DartClass[]): StateEntry[] {
  const entries: StateEntry[] = [];

  for (const cls of classes) {
    if (!cls.superclass) continue;
    if (!cls.superclass.includes("GetxController") && !cls.superclass.includes("GetxService")) continue;

    const observableFields = cls.fields.filter(
      (f) => f.type.startsWith("Rx") || f.type.includes(".obs") || f.defaultValue?.includes(".obs")
    );

    const entry: StateEntry = {
      className: cls.name,
      type: cls.superclass,
      stateFields: observableFields.map((f) => `${f.name} (${f.type})`),
      methods: cls.methods
        .filter((m) => !m.name.startsWith("_"))
        .map((m) => formatMethod(m)),
    };

    entries.push(entry);
  }

  return entries;
}

// --- Provider / ChangeNotifier ---

function parseChangeNotifiers(classes: DartClass[]): StateEntry[] {
  const entries: StateEntry[] = [];

  for (const cls of classes) {
    if (!cls.superclass) continue;
    if (!cls.superclass.includes("ChangeNotifier")) continue;

    const entry: StateEntry = {
      className: cls.name,
      type: "ChangeNotifier",
      stateFields: cls.fields.map((f) => `${f.name} (${f.type})`),
      methods: cls.methods
        .filter((m) => !m.name.startsWith("_"))
        .map((m) => formatMethod(m)),
    };

    entries.push(entry);
  }

  return entries;
}

// --- MobX ---

function parseMobXStores(classes: DartClass[]): StateEntry[] {
  const entries: StateEntry[] = [];

  for (const cls of classes) {
    const hasObservable = cls.annotations.includes("observable") ||
      cls.fields.some((f) => f.type.includes("Observable"));

    // Also check if class uses MobX mixin pattern: with _$ClassName
    const hasMobXMixin = cls.mixins.some((m) => m.startsWith("_$"));

    if (!hasObservable && !hasMobXMixin) continue;

    const entry: StateEntry = {
      className: cls.name,
      type: "MobX Store",
      stateFields: cls.fields
        .filter((f) => !f.name.startsWith("_"))
        .map((f) => `${f.name} (${f.type})`),
      methods: cls.methods
        .filter((m) => !m.name.startsWith("_"))
        .map((m) => formatMethod(m)),
    };

    entries.push(entry);
  }

  return entries;
}

function formatMethod(m: DartMethod): string {
  const params = m.params.map((p) => p.name).join(", ");
  const asyncStr = m.isAsync ? " (async)" : "";
  return `${m.name}(${params})${m.returnType !== "void" ? ` → ${m.returnType}` : ""}${asyncStr}`;
}

function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export async function scanState(options: ScanOptions): Promise<ScanResult | null> {
  const statePackage = detectStatePackage(options.rootDir);
  if (statePackage === "unknown") return null;

  const dartFiles = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".dart"],
  });

  const allEntries: StateEntry[] = [];

  // First pass: parse every file's classes so state-shape lookups can cross files
  const fileData: { filePath: string; content: string; classes: DartClass[] }[] = [];
  for (const filePath of dartFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (filePath.endsWith(".g.dart") || filePath.endsWith(".freezed.dart")) continue;

    const classes = getDartClasses(filePath, content);
    fileData.push({ filePath, content, classes });
  }

  const allClasses = fileData.flatMap((fd) => fd.classes);

  for (const { content, classes } of fileData) {
    switch (statePackage) {
      case "riverpod":
        allEntries.push(...parseRiverpodProviders(content, classes, allClasses));
        break;
      case "bloc":
        allEntries.push(...parseBlocClasses(classes, allClasses));
        break;
      case "getx":
        allEntries.push(...parseGetXControllers(classes));
        break;
      case "provider":
        allEntries.push(...parseChangeNotifiers(classes));
        break;
      case "mobx":
        allEntries.push(...parseMobXStores(classes));
        break;
    }
  }

  if (allEntries.length === 0) return null;

  // Build markdown
  const packageLabel = {
    riverpod: "Riverpod",
    bloc: "Bloc",
    getx: "GetX",
    provider: "Provider",
    mobx: "MobX",
  }[statePackage];

  const sections: string[] = [
    heading(1, "State Management"),
    heading(2, `Package: ${packageLabel}`),
  ];

  for (const entry of allEntries) {
    const lines: string[] = [];
    if (entry.providerName) lines.push(`**Provider:** ${entry.providerName}`);
    if (entry.stateShape) {
      const variants = entry.stateShape.variants
        ? ` (variants: ${entry.stateShape.variants.join(" | ")})`
        : "";
      lines.push(`**State:** ${entry.stateShape.name}${variants}`);
      if (entry.stateShape.fields.length > 0) {
        lines.push(`**State shape:** ${entry.stateShape.fields.join(", ")}`);
      }
    }
    if (entry.stateFields.length > 0) {
      lines.push(`**Notifier fields:** ${entry.stateFields.join(", ")}`);
    }
    if (entry.methods.length > 0) {
      lines.push(`**Methods:** ${entry.methods.join(", ")}`);
    }

    sections.push(joinSections(
      heading(3, `${entry.className} (${entry.type})`),
      bulletList(lines),
    ));
  }

  return {
    filename: "state.md",
    content: sections.join("\n\n") + "\n",
  };
}
