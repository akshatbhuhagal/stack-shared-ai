# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

CLI tool (`stack-shared-ai`) that scans codebases and generates compact markdown index files for AI assistants. Supports Flutter, Express, NestJS, Next.js, Bun, and TypeScript libraries with a pluggable scanner architecture. Outputs go to `.stack-shared-ai/` by default.

## Build & Run

```bash
npm run build          # tsc → dist/
npm run dev            # tsc --watch
node dist/cli.js       # run against current dir
node dist/cli.js test-fixtures/flutter-app --verbose   # test against fixture
node dist/cli.js <dir> --dry-run                       # preview without writing
```

No test framework is set up yet. Verify changes by building (`npx tsc`) and running against `test-fixtures/flutter-app/`.

## Architecture

**Flow:** `cli.ts` → `config.ts` (load + merge) → `runner.ts` (orchestrate) → framework scanners → write `.stack-shared-ai/*.md`

**Scanner plugin system:** Each framework implements the `Scanner` interface (`scanners/types.ts`):
- `detect(rootDir)` — returns true if this framework is present
- `scan(options)` — returns `ScanResult[]` (filename + markdown content)

Scanners are registered in `cli.ts` via `registerScanner(framework, loaderFn)`. The runner looks up registered scanners by framework name.

**Framework detection** (`detector.ts`): Checks `pubspec.yaml` (Flutter), `package.json` deps for `@nestjs/core` / `express` / `next`, `bunfig.toml` or `@types/bun` / bun-using scripts (Bun), and `typescript` as a library fallback (only when no app framework matched). NestJS suppresses the Express scanner since `@nestjs/platform-express` pulls express transitively. Falls back to scanning subdirectories for monorepo support.

**Per-framework scanners** (`scanners/<framework>/`): Each sub-scanner is a standalone async function returning `ScanResult | null`. The framework-level `Scanner.scan()` calls them in sequence, skipping nulls and catching errors per sub-scanner.

- **Flutter** (`scanners/flutter/`): deps, models, components, screens, state, api-client
- **Express** (`scanners/express/`): deps, routes, middleware, schema, services, config
- **NestJS** (`scanners/nestjs/`): deps, controllers, modules, providers, config
- **Next.js** (`scanners/nextjs/`): deps, routes, layouts, server-actions, middleware, components, config
- **Bun** (`scanners/bun/`): deps, routes, config
- **TypeScript library** (`scanners/typescript/`): deps, exports, types, api

**Parsing utilities:**
- `utils/dart-parser.ts` — Regex-based Dart class/field/method extraction. Handles `this.param` constructor syntax by resolving against parsed fields.
- `utils/ts-parser.ts` — Uses `ts-morph` for TypeScript/JS AST parsing. Has `allowJs: true` to support plain JS.
- `utils/file-walker.ts` — Recursive directory traversal with include/exclude filtering.

## Key Design Decisions

- Dart parsing uses regex (no Dart AST lib in JS); plan to add `dart analyze --format=json` for accuracy
- Express scanner must support plain JS from day 1 (not just TypeScript)
- Output format supports both markdown and JSON
- User-defined scanner plugins planned for v1
- Config file (`stack-shared-ai.config.json`) values are overridden by CLI flags

## Test Fixture

`test-fixtures/flutter-app/` contains a mock Flutter project with GoRouter, Riverpod, Dio, Freezed, and json_serializable. All 6 Flutter scanners produce output against it.
