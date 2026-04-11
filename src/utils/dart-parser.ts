export interface DartClass {
  name: string;
  superclass?: string;
  mixins: string[];
  annotations: string[];
  fields: DartField[];
  methods: DartMethod[];
  constructorParams: DartParam[];
  filePath: string;
  // Dart 3 class modifiers (sealed, base, final, interface, abstract)
  modifiers?: string[];
}

export interface DartExtension {
  name: string;
  on: string;
  members: string[]; // method/getter names
}

export interface DartTypedef {
  name: string;
  value: string; // the right-hand side of the typedef
}

export interface DartField {
  name: string;
  type: string;
  isFinal: boolean;
  isLate: boolean;
  isNullable: boolean;
  defaultValue?: string;
}

export interface DartMethod {
  name: string;
  returnType: string;
  params: DartParam[];
  isAsync: boolean;
  isStatic: boolean;
}

export interface DartParam {
  name: string;
  type: string;
  isRequired: boolean;
  isNamed: boolean;
  defaultValue?: string;
}

const CLASS_REGEX = /^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+(?:<[^>]+>)?))?(?:\s+with\s+([\w,\s]+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/gm;
const ANNOTATION_REGEX = /^@(\w+)(?:\(([^)]*)\))?/gm;
const FIELD_REGEX = /^\s+(final\s+|late\s+)?([\w<>,?\s]+)\s+(\w+)\s*(?:=\s*(.+))?\s*;/gm;
const CONSTRUCTOR_REGEX = /(\w+)\(([^)]*)\)/;

export function parseClassDeclarations(content: string, filePath: string): DartClass[] {
  const classes: DartClass[] = [];
  const lines = content.split("\n");

  let currentAnnotations: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Collect annotations
    const annoMatch = line.trim().match(/^@(\w+)(?:\(([^)]*)\))?$/);
    if (annoMatch) {
      currentAnnotations.push(annoMatch[1]);
      continue;
    }

    // Match class declaration, including Dart 3 modifiers:
    //   sealed class, base class, final class, interface class, abstract class,
    //   plus combos like "abstract base class", "sealed class" (used by freezed union types).
    const classMatch = line.match(
      /^((?:(?:abstract|sealed|base|final|interface|mixin)\s+)*)class\s+(\w+)(?:\s+extends\s+([\w<>,?\s]+))?(?:\s+with\s+([\w,\s]+))?(?:\s+implements\s+([\w,\s]+))?\s*\{?/
    );
    if (classMatch) {
      const modifiersStr = classMatch[1] || "";
      const modifiers = modifiersStr.trim().split(/\s+/).filter(Boolean);
      const dartClass: DartClass = {
        name: classMatch[2],
        superclass: classMatch[3]?.trim(),
        mixins: classMatch[4] ? classMatch[4].split(",").map((m) => m.trim()) : [],
        annotations: [...currentAnnotations],
        fields: [],
        methods: [],
        constructorParams: [],
        filePath,
        modifiers: modifiers.length > 0 ? modifiers : undefined,
      };

      // Parse class body for fields and methods
      const classBody = extractClassBody(lines, i);
      dartClass.fields = parseFields(classBody);
      dartClass.constructorParams = parseConstructorParams(classBody, dartClass.name, dartClass.fields);
      dartClass.methods = parseMethods(classBody);

      classes.push(dartClass);
      currentAnnotations = [];
    } else if (line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith("import")) {
      currentAnnotations = [];
    }
  }

  return classes;
}

function extractClassBody(lines: string[], startLine: number): string {
  let braceCount = 0;
  let started = false;
  const bodyLines: string[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === "{") { braceCount++; started = true; }
      if (char === "}") braceCount--;
    }
    bodyLines.push(line);
    if (started && braceCount === 0) break;
  }

  return bodyLines.join("\n");
}

function parseFields(classBody: string): DartField[] {
  const fields: DartField[] = [];
  const regex = /^\s+(final\s+|late\s+|static\s+)*([\w<>,?\s]+?)\s+(\w+)\s*(?:=\s*([^;]+))?\s*;/gm;
  let match;

  while ((match = regex.exec(classBody)) !== null) {
    const modifiers = match[1] || "";
    const type = match[2].trim();
    const name = match[3];

    // Skip common non-field patterns
    if (["return", "var", "final"].includes(type)) continue;

    fields.push({
      name,
      type,
      isFinal: modifiers.includes("final"),
      isLate: modifiers.includes("late"),
      isNullable: type.endsWith("?"),
      defaultValue: match[4]?.trim(),
    });
  }

  return fields;
}

function parseConstructorParams(classBody: string, className: string, fields: DartField[]): DartParam[] {
  // Match constructor: ClassName({required Type name, ...}) or ClassName(Type name, ...)
  const ctorRegex = new RegExp(`${className}\\s*\\(([^)]*)\\)`, "s");
  const match = classBody.match(ctorRegex);
  if (!match) return [];

  const paramStr = match[1].trim();
  if (!paramStr) return [];

  const params = parseParamList(paramStr);

  // Resolve `this.` params by looking up the field type
  const fieldMap = new Map(fields.map((f) => [f.name, f]));
  for (const param of params) {
    if (param.type === "this") {
      const field = fieldMap.get(param.name);
      param.type = field ? field.type : "dynamic";
    }
  }

  return params;
}

export function parseParamList(paramStr: string): DartParam[] {
  const params: DartParam[] = [];
  // Remove outer braces for named params
  const isNamed = paramStr.includes("{");
  const cleaned = paramStr.replace(/[{}]/g, "").trim();
  if (!cleaned) return [];

  const parts = splitParams(cleaned);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Skip 'super.key', 'Key? key'
    if (trimmed.includes("super.") || trimmed.match(/Key\??\s+key/)) continue;

    const isRequired = trimmed.startsWith("required ");
    const withoutRequired = trimmed.replace(/^required\s+/, "");

    // Handle this.param syntax: `this.label` or `this.label = defaultVal`
    const thisMatch = withoutRequired.match(/^this\.(\w+)(?:\s*=\s*(.+))?$/);
    if (thisMatch) {
      params.push({
        type: "this",  // placeholder — resolved by caller using field types
        name: thisMatch[1],
        isRequired: isRequired || !isNamed,
        isNamed,
        defaultValue: thisMatch[2]?.trim(),
      });
      continue;
    }

    // Match: Type name = default
    const paramMatch = withoutRequired.match(/^([\w<>,?\s]+?)\s+(\w+)(?:\s*=\s*(.+))?$/);
    if (paramMatch) {
      params.push({
        type: paramMatch[1].trim(),
        name: paramMatch[2],
        isRequired: isRequired || !isNamed,
        isNamed,
        defaultValue: paramMatch[3]?.trim(),
      });
    }
  }

  return params;
}

function splitParams(paramStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of paramStr) {
    if (char === "<" || char === "(") depth++;
    if (char === ">" || char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);

  return parts;
}

function parseMethods(classBody: string): DartMethod[] {
  const methods: DartMethod[] = [];
  const regex = /^\s+(static\s+)?([\w<>,?\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(async\s*)?\{/gm;
  let match;

  while ((match = regex.exec(classBody)) !== null) {
    const name = match[3];
    // Skip constructors and private methods that are likely implementation details
    if (name === "build" || name === "initState" || name === "dispose") continue;

    methods.push({
      name,
      returnType: match[2].trim(),
      params: parseParamList(match[4]),
      isAsync: !!match[5],
      isStatic: !!match[1],
    });
  }

  return methods;
}

// -----------------------------------------------------------------------
// Analyzer-backed cache
// -----------------------------------------------------------------------
// The Flutter scanner may pre-populate this cache by running the Dart
// analyzer helper in a single batch (see `utils/dart-analyzer-bridge.ts`
// and `scanners/flutter/index.ts`). Sub-scanners should use
// `getDartClasses(filePath, content)` / `getDartEnums(filePath, content)`
// instead of calling `parseClassDeclarations` directly — those helpers
// return cached analyzer output when available and fall back to the regex
// parser otherwise.

interface CachedDartFile {
  classes: DartClass[];
  enums: { name: string; values: string[] }[];
}

const dartSymbolCache = new Map<string, CachedDartFile>();

export function primeDartCache(
  entries: Map<string, CachedDartFile>,
): void {
  for (const [file, data] of entries) {
    dartSymbolCache.set(file, data);
  }
}

export function clearDartCache(): void {
  dartSymbolCache.clear();
}

export function getDartClasses(filePath: string, content: string): DartClass[] {
  const cached = dartSymbolCache.get(filePath);
  if (cached) return cached.classes;
  return parseClassDeclarations(content, filePath);
}

export function getDartEnums(
  filePath: string,
  content: string,
): { name: string; values: string[] }[] {
  const cached = dartSymbolCache.get(filePath);
  if (cached) return cached.enums;
  return parseEnumDeclarations(content);
}

// extension NameOnType on TypeArg<...> { ... }
// Also matches: extension type NameType(Inner value) { ... }  (Dart 3 extension types)
export function parseExtensionDeclarations(content: string): DartExtension[] {
  const out: DartExtension[] = [];
  const re = /extension\s+(?:type\s+)?(\w+)(?:<[^>]+>)?\s+on\s+([\w<>?, ]+?)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    const on = m[2].trim();
    // Extract method/getter names from the body — shallow scan, up to the
    // next top-level `}`. This is best-effort; the analyzer path is richer.
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = content.slice(bodyStart, i - 1);
    const members: string[] = [];
    // Getters:   double get total => ...   /   int get count { ... }
    const getterRe = /\bget\s+(\w+)\s*(?:=>|\{)/g;
    let mm: RegExpExecArray | null;
    while ((mm = getterRe.exec(body)) !== null) {
      if (!members.includes(mm[1])) members.push(mm[1]);
    }
    // Methods:   void foo() { ... } / Type foo(args) => ... / static Type foo(...)
    const methodRe = /(?:^|\n)\s+(?:static\s+)?(?:[\w<>?, ]+\s+)(\w+)\s*\(/g;
    while ((mm = methodRe.exec(body)) !== null) {
      const name = mm[1];
      if (["if", "for", "while", "return", "switch", "try", "do"].includes(name)) continue;
      if (!members.includes(name)) members.push(name);
    }
    out.push({ name, on, members });
  }
  return out;
}

// typedef Name = Type;  (Dart 2.13+ syntax)
// typedef Name = void Function(int x);
// Legacy typedef void Callback(int x);   — also handled.
export function parseTypedefDeclarations(content: string): DartTypedef[] {
  const out: DartTypedef[] = [];
  // Modern syntax
  const modernRe = /typedef\s+(\w+)(?:<[^>]+>)?\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = modernRe.exec(content)) !== null) {
    out.push({ name: m[1], value: m[2].trim().replace(/\s+/g, " ") });
  }
  // Legacy syntax: typedef <ReturnType> Name(params);
  const legacyRe = /typedef\s+([\w<>?, ]+?)\s+(\w+)\s*\(([^)]*)\)\s*;/g;
  while ((m = legacyRe.exec(content)) !== null) {
    // Skip if already captured by modern form
    if (out.some((t) => t.name === m![2])) continue;
    out.push({ name: m[2], value: `${m[1].trim()} Function(${m[3].trim()})` });
  }
  return out;
}

export function parseEnumDeclarations(content: string): { name: string; values: string[] }[] {
  const enums: { name: string; values: string[] }[] = [];
  const regex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const values = match[2]
      .split(",")
      .map((v) => v.trim().split("(")[0].split("/")[0].trim())
      .filter((v) => v && !v.startsWith("//"));
    enums.push({ name, values });
  }

  return enums;
}
