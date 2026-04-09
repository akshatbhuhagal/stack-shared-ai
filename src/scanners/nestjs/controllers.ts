import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { heading } from "../../utils/markdown";
import { walkFiles } from "../../utils/file-walker";

interface RouteEntry {
  method: string;
  path: string;
  handler: string;
  guards: string[];
  file: string;
}

const HTTP_DECORATORS = ["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"];

function stripQuotes(s: string): string {
  return s.trim().replace(/^['"`]|['"`]$/g, "");
}

function joinPath(prefix: string, sub: string): string {
  const p = prefix.replace(/^\/+|\/+$/g, "");
  const s = sub.replace(/^\/+|\/+$/g, "");
  if (!p && !s) return "/";
  if (!p) return "/" + s;
  if (!s) return "/" + p;
  return "/" + p + "/" + s;
}

export async function scanControllers(options: ScanOptions): Promise<ScanResult | null> {
  const files = walkFiles(options.rootDir, {
    include: options.include,
    exclude: options.exclude,
    extensions: [".ts"],
  }).filter((f) => !f.endsWith(".d.ts") && !f.endsWith(".spec.ts") && !f.endsWith(".test.ts"));

  const routes: RouteEntry[] = [];
  const byController: Map<string, { prefix: string; file: string; routes: RouteEntry[] }> = new Map();

  const controllerRe = /@Controller\s*\(([^)]*)\)\s*export\s+class\s+(\w+)/g;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!content.includes("@Controller")) continue;

    controllerRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = controllerRe.exec(content)) !== null) {
      const prefixArg = m[1].trim();
      const className = m[2];
      const prefix = prefixArg ? stripQuotes(prefixArg.split(",")[0]) : "";

      // Find the class body start
      const classStart = content.indexOf("{", m.index + m[0].length);
      if (classStart === -1) continue;
      // Walk balanced braces to find class end
      let depth = 1;
      let i = classStart + 1;
      while (i < content.length && depth > 0) {
        const c = content[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth === 0) break;
        i++;
      }
      const body = content.slice(classStart + 1, i);

      // Scan body for HTTP decorators, then walk forward skipping any
      // additional decorators (@UseGuards, @HttpCode, etc) to find the actual
      // handler method name.
      const httpDecoratorRe = new RegExp(
        `@(${HTTP_DECORATORS.join("|")})\\s*\\(([^)]*)\\)`,
        "g",
      );
      const entries: RouteEntry[] = [];
      let mm: RegExpExecArray | null;
      while ((mm = httpDecoratorRe.exec(body)) !== null) {
        const method = mm[1].toUpperCase();
        const subPath = stripQuotes(mm[2].trim().split(",")[0] || "");

        // Walk forward from the end of this decorator, collecting any
        // intervening @Decorator(...) calls (for guards) until we hit an
        // identifier that is the method name.
        let cursor = mm.index + mm[0].length;
        const guards: string[] = [];
        let handler = "";
        while (cursor < body.length) {
          // skip whitespace
          while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
          if (cursor >= body.length) break;
          if (body[cursor] === "@") {
            // Parse decorator name
            const nameMatch = /^@(\w+)/.exec(body.slice(cursor));
            if (!nameMatch) break;
            const decName = nameMatch[1];
            // If this is another HTTP decorator, this slot is a same-method
            // alias — stop and let the outer loop handle it.
            if (HTTP_DECORATORS.includes(decName)) break;
            cursor += nameMatch[0].length;
            // Skip balanced parens if present
            while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
            if (body[cursor] === "(") {
              let depth = 1;
              const argStart = cursor + 1;
              cursor++;
              while (cursor < body.length && depth > 0) {
                if (body[cursor] === "(") depth++;
                else if (body[cursor] === ")") depth--;
                if (depth === 0) break;
                cursor++;
              }
              const argStr = body.slice(argStart, cursor);
              cursor++; // past closing )
              if (decName === "UseGuards") {
                guards.push(
                  ...argStr
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                );
              }
            }
            continue;
          }
          // Not a decorator — expect an access modifier or the method name
          const idMatch = /^(public|private|protected|async|static)\s+/.exec(body.slice(cursor));
          if (idMatch) {
            cursor += idMatch[0].length;
            continue;
          }
          const handlerMatch = /^(\w+)\s*\(/.exec(body.slice(cursor));
          if (handlerMatch) {
            handler = handlerMatch[1];
          }
          break;
        }
        if (!handler) continue;

        entries.push({
          method,
          path: joinPath(prefix, subPath),
          handler,
          guards,
          file: path.relative(options.rootDir, file).replace(/\\/g, "/"),
        });
      }

      if (entries.length > 0) {
        byController.set(className, {
          prefix: prefix ? "/" + prefix.replace(/^\/+|\/+$/g, "") : "/",
          file: path.relative(options.rootDir, file).replace(/\\/g, "/"),
          routes: entries,
        });
        routes.push(...entries);
      }
    }
  }

  if (byController.size === 0) return null;

  const sections: string[] = [heading(1, "Controllers")];

  const sortedControllers = Array.from(byController.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [className, info] of sortedControllers) {
    sections.push(heading(2, `${className}  \`${info.prefix}\``));
    sections.push(`_${info.file}_`);
    const lines: string[] = [];
    for (const r of info.routes) {
      const guardSuffix = r.guards.length > 0 ? ` [${r.guards.join(", ")}]` : "";
      lines.push(`- \`${r.method.padEnd(6)} ${r.path}\`${guardSuffix} → ${r.handler}()`);
    }
    sections.push(lines.join("\n"));
  }

  return {
    filename: "controllers.md",
    content: sections.join("\n\n") + "\n",
  };
}
