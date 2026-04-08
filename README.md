# stack-shared-ai

CLI tool that scans your codebase and generates compact, structured markdown index files for AI assistants. Instead of letting your AI tool re-read thousands of files every conversation, point it at `.stack-shared-ai/` and save 50K+ tokens per session.

Currently supports **Flutter** and **Express** projects, with a pluggable scanner architecture for adding more frameworks.

## Installation

```bash
# Run directly without installing
npx stack-shared-ai

# Or install globally
npm install -g stack-shared-ai
stack-shared-ai
```

## Quick Start

From the root of your project:

```bash
# Auto-detect framework and generate index files into .stack-shared-ai/
npx stack-shared-ai

# Preview what would be generated, without writing anything
npx stack-shared-ai --dry-run --verbose

# Scan a specific directory
npx stack-shared-ai ./path/to/project
```

After running, point your AI assistant at the `.stack-shared-ai/` folder (e.g. add it to your `CLAUDE.md`, `.cursorrules`, or equivalent).

## Supported Frameworks

| Framework | Detection | Generated Files |
|-----------|-----------|-----------------|
| **Flutter** | `pubspec.yaml` with `flutter` dependency | `deps.md`, `models.md`, `components.md`, `screens.md`, `state.md`, `api-client.md` |
| **Express** | `package.json` with `express` dependency | `deps.md`, `routes.md`, `middleware.md`, `services.md`, `schema.md`, `config.md` |

Monorepos are supported — if no framework is found at the root, subdirectories are scanned.

### What gets extracted

**Flutter:**
- `deps.md` — packages from `pubspec.yaml`
- `models.md` — data classes, fields, Freezed/json_serializable models
- `components.md` — reusable widgets
- `screens.md` — screens and GoRouter routes
- `state.md` — Riverpod / Provider / Bloc state
- `api-client.md` — Dio / http API calls

**Express:**
- `deps.md` — packages from `package.json`
- `routes.md` — Express routes and handlers
- `middleware.md` — middleware stack
- `services.md` — business logic modules
- `schema.md` — database schema (e.g. Prisma)
- `config.md` — env vars and config

Both TypeScript and plain JavaScript Express projects are supported.

## CLI Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default: `.stack-shared-ai`) |
| `-i, --include <dirs...>` | Only scan these directories |
| `-e, --exclude <dirs...>` | Exclude these directories |
| `-f, --framework <frameworks...>` | Force a specific framework (`flutter`, `express`) |
| `-s, --schema <path>` | Path to database schema file (e.g. `prisma/schema.prisma`) |
| `--format <format>` | Output format: `markdown` (default) or `json` |
| `--dry-run` | Print what would be generated without writing files |
| `--verbose` | Show detailed scanner output |

CLI flags always override values from the config file.

## Configuration File

Create a `stack-shared-ai.config.json` in your project root to set defaults:

```json
{
  "output": ".stack-shared-ai",
  "include": ["src", "lib", "app"],
  "exclude": ["tests", "__mocks__", "build", ".dart_tool"],
  "schema": "prisma/schema.prisma",
  "frameworks": ["flutter", "express"]
}
```

## Using with AI Assistants

After generating the index, reference `.stack-shared-ai/` from your assistant's instructions file. Example for Claude Code (`CLAUDE.md`):

```markdown
For an overview of this codebase, read the files in `.stack-shared-ai/`
before exploring source files directly.
```

Re-run `npx stack-shared-ai` after major refactors to keep the index fresh.

## License

MIT
