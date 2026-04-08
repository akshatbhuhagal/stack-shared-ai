import * as path from "path";
import { StackSharedAIPlugin } from "./scanners/types";
import { Framework } from "./detector";
import { registerScanner, registerCrossStackScanner } from "./runner";

// Load a plugin module from a path (absolute or relative to rootDir).
// A plugin file must export a StackSharedAIPlugin as either its default
// export or a named `plugin` export. CommonJS `module.exports = {...}` also
// works since `require` returns the module.exports object directly.
export async function loadPlugins(rootDir: string, pluginPaths: string[], verbose: boolean): Promise<void> {
  const log = verbose ? console.log : () => {};

  for (const raw of pluginPaths) {
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
    let mod: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(resolved);
    } catch (err) {
      console.warn(`Failed to load plugin ${raw}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const plugin = extractPlugin(mod);
    if (!plugin) {
      console.warn(`Plugin ${raw} did not export a valid StackSharedAIPlugin (expected default, .plugin, or module.exports)`);
      continue;
    }

    log(`Loaded plugin: ${plugin.name}`);

    if (plugin.framework) {
      const { key, scanner } = plugin.framework;
      registerScanner(key as Framework, async () => scanner);
      log(`  Registered framework scanner: ${key}`);
    }

    if (plugin.crossStack) {
      for (const cs of plugin.crossStack) {
        registerCrossStackScanner(cs);
        log(`  Registered cross-stack scanner: ${cs.name}`);
      }
    }
  }
}

function extractPlugin(mod: unknown): StackSharedAIPlugin | null {
  if (!mod || typeof mod !== "object") return null;
  const m = mod as Record<string, unknown>;
  const candidate = (m.default ?? m.plugin ?? m) as Record<string, unknown>;
  if (typeof candidate.name !== "string") return null;
  return candidate as unknown as StackSharedAIPlugin;
}
