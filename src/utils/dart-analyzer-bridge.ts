// Bridge to the Dart analyzer helper (`dart_helper/bin/extract.dart`).
//
// When the Dart SDK is available on PATH, this module can run the helper to
// get authoritative class/field/method data for a batch of .dart files.
// Results are returned in the same shape as the regex-based parser so the
// two paths are interchangeable from the scanners' perspective.
//
// If Dart isn't installed, the helper directory is missing, `dart pub get`
// fails, or the extractor crashes, every function here returns null and the
// caller falls back to the regex parser.

import { spawnSync, SpawnSyncOptions, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DartClass, DartField, DartMethod, DartParam } from "./dart-parser";

// dist/utils/dart-analyzer-bridge.js -> ../../dart_helper
const HELPER_DIR = path.resolve(__dirname, "..", "..", "dart_helper");
const HELPER_SCRIPT = path.join(HELPER_DIR, "bin", "extract.dart");

// Cross-platform `dart` invocation. On Windows the SDK ships `dart.bat`
// which Node (>= 20) refuses to spawn without `shell: true`. Passing args
// as a single string avoids DEP0190.
function runDart(
  args: string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    const quoted = args
      .map((a) => `"${a.replace(/"/g, '\\"')}"`)
      .join(" ");
    return spawnSync(`dart ${quoted}`, {
      ...opts,
      shell: true,
      encoding: "utf-8",
    }) as SpawnSyncReturns<string>;
  }
  return spawnSync("dart", args, {
    ...opts,
    shell: false,
    encoding: "utf-8",
  }) as SpawnSyncReturns<string>;
}

let dartAvailableCache: boolean | null = null;
let pubGetDone = false;

export function isDartAvailable(): boolean {
  if (dartAvailableCache !== null) return dartAvailableCache;
  try {
    const r = runDart(["--version"], { stdio: "ignore" });
    dartAvailableCache = r.status === 0;
  } catch {
    dartAvailableCache = false;
  }
  return dartAvailableCache!;
}

function ensurePubGet(verbose: boolean): boolean {
  if (pubGetDone) return true;
  if (!fs.existsSync(HELPER_DIR) || !fs.existsSync(HELPER_SCRIPT)) return false;
  const dartTool = path.join(HELPER_DIR, ".dart_tool");
  if (fs.existsSync(dartTool)) {
    pubGetDone = true;
    return true;
  }
  if (verbose) {
    console.log("  [dart-bridge] Running `dart pub get` for helper (first-time setup)...");
  }
  const r = runDart(["pub", "get"], {
    cwd: HELPER_DIR,
    stdio: verbose ? "inherit" : "ignore",
  });
  if (r.status !== 0) {
    if (verbose) console.warn("  [dart-bridge] `dart pub get` failed; falling back to regex parser");
    return false;
  }
  pubGetDone = true;
  return true;
}

interface RawParam {
  name: string;
  type: string;
  isRequired: boolean;
  isNamed: boolean;
  defaultValue?: string;
}

interface RawField {
  name: string;
  type: string;
  isFinal: boolean;
  isLate: boolean;
  isNullable: boolean;
  defaultValue?: string;
}

interface RawMethod {
  name: string;
  returnType: string;
  isAsync: boolean;
  isStatic: boolean;
  params: RawParam[];
}

interface RawClass {
  name: string;
  superclass?: string;
  mixins: string[];
  annotations: string[];
  fields: RawField[];
  methods: RawMethod[];
  constructorParams: RawParam[];
  filePath: string;
}

interface RawEnum {
  name: string;
  values: string[];
}

interface FileResult {
  file: string;
  classes?: RawClass[];
  enums?: RawEnum[];
  error?: string;
}

export interface DartSymbols {
  classes: DartClass[];
  enums: { name: string; values: string[] }[];
}

function toDartClass(raw: RawClass): DartClass {
  const fields: DartField[] = raw.fields.map((f) => ({
    name: f.name,
    type: f.type,
    isFinal: f.isFinal,
    isLate: f.isLate,
    isNullable: f.isNullable,
    defaultValue: f.defaultValue,
  }));

  const fieldMap = new Map(fields.map((f) => [f.name, f]));

  const resolveParam = (p: RawParam): DartParam => {
    let type = p.type;
    // `this.foo` constructor params come through as type === "this" — resolve
    // against the parsed fields, same as the regex parser does.
    if (type === "this") {
      const field = fieldMap.get(p.name);
      type = field ? field.type : "dynamic";
    }
    return {
      name: p.name,
      type,
      isRequired: p.isRequired,
      isNamed: p.isNamed,
      defaultValue: p.defaultValue,
    };
  };

  const methods: DartMethod[] = raw.methods.map((m) => ({
    name: m.name,
    returnType: m.returnType,
    isAsync: m.isAsync,
    isStatic: m.isStatic,
    params: m.params.map(resolveParam),
  }));

  return {
    name: raw.name,
    superclass: raw.superclass,
    mixins: raw.mixins,
    annotations: raw.annotations,
    fields,
    methods,
    constructorParams: raw.constructorParams.map(resolveParam),
    filePath: raw.filePath,
  };
}

/**
 * Run the Dart helper on a batch of file paths. Returns a map keyed by the
 * absolute file path. Returns null if Dart is not available or the helper
 * failed — callers should fall back to the regex parser in that case.
 */
export function runDartExtractor(
  files: string[],
  verbose = false,
): Map<string, DartSymbols> | null {
  if (files.length === 0) return new Map();
  if (!isDartAvailable()) {
    if (verbose) console.log("  [dart-bridge] Dart SDK not on PATH; using regex parser");
    return null;
  }
  if (!fs.existsSync(HELPER_SCRIPT)) {
    if (verbose) console.log("  [dart-bridge] helper script missing; using regex parser");
    return null;
  }
  if (!ensurePubGet(verbose)) return null;

  if (verbose) {
    console.log(`  [dart-bridge] Analyzing ${files.length} Dart file(s) via analyzer package`);
  }

  // Pipe file paths via stdin to avoid blowing past the command-line length
  // limit on Windows.
  const stdinPayload = files.join("\n") + "\n";
  const r = runDart(["run", HELPER_SCRIPT], {
    cwd: HELPER_DIR,
    input: stdinPayload,
    maxBuffer: 100 * 1024 * 1024,
  });

  if (r.status !== 0) {
    if (verbose) {
      console.warn(`  [dart-bridge] extractor exited with status ${r.status}: ${r.stderr?.slice(0, 400)}`);
    }
    return null;
  }

  let parsed: FileResult[];
  try {
    // `dart run` may print "Resolving dependencies..." lines before the
    // JSON payload the first time. The extractor writes a single JSON array
    // — find it by the last `[` before EOF.
    const out = r.stdout ?? "";
    const jsonStart = out.indexOf("[");
    const jsonEnd = out.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      if (verbose) console.warn("  [dart-bridge] no JSON payload found in helper output");
      return null;
    }
    parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1)) as FileResult[];
  } catch (e) {
    if (verbose) console.warn(`  [dart-bridge] failed to parse helper output: ${e}`);
    return null;
  }

  const result = new Map<string, DartSymbols>();
  for (const entry of parsed) {
    if (entry.error) continue;
    result.set(entry.file, {
      classes: (entry.classes ?? []).map(toDartClass),
      enums: (entry.enums ?? []).map((e) => ({ name: e.name, values: e.values })),
    });
  }
  return result;
}
