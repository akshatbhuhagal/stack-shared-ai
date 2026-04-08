# stack-shared-ai

CLI tool that scans your codebase and generates compact, structured index files for AI assistants — covering backend, frontend, and mobile development. Saves 50K+ tokens per AI conversation.

## Quick Start

```bash
# Auto-detect frameworks and generate index files
npx stack-shared-ai

# Custom output directory
npx stack-shared-ai --output .claude/codex

# Scan specific directories only
npx stack-shared-ai --include src lib app

# Force a specific framework
npx stack-shared-ai --framework flutter
npx stack-shared-ai --framework express

# Preview without writing files
npx stack-shared-ai --dry-run --verbose
```

## Supported Frameworks

| Framework | Status | Detection |
|-----------|--------|-----------|
| Flutter   | In progress | `pubspec.yaml` with `flutter` dependency |
| Express   | In progress | `package.json` with `express` dependency |

## Configuration

Create a `stack-shared-ai.config.json` in your project root:

```json
{
  "output": ".stack-shared-ai",
  "include": ["src", "lib", "app"],
  "exclude": ["tests", "__mocks__", "build", ".dart_tool"],
  "schema": "prisma/schema.prisma",
  "frameworks": ["flutter", "express"]
}
```

CLI flags override config file values.

## CLI Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default: `.stack-shared-ai`) |
| `-i, --include <dirs...>` | Only scan these directories |
| `-e, --exclude <dirs...>` | Exclude these directories |
| `-f, --framework <frameworks...>` | Force specific framework(s) |
| `-s, --schema <path>` | Path to database schema file |
| `--format <format>` | Output format: `markdown` or `json` |
| `--dry-run` | Preview without writing |
| `--verbose` | Detailed output |
| `--watch` | Re-generate on file changes |

## Output

Generated files are placed in `.stack-shared-ai/` (or your custom output directory):

- `overview.md` — Architecture summary
- `routes.md` — API routes (Express)
- `screens.md` — Screen inventory (Flutter)
- `schema.md` — Database schema
- `state.md` — State management
- `components.md` — Reusable widgets/components
- `models.md` — Data models
- `api-client.md` — API calls from mobile
- `api-contract.md` — Backend <-> mobile alignment
- `middleware.md` — Middleware stack
- `services.md` — Business logic
- `lib.md` — Utility functions
- `config.md` — Env vars and config
- `deps.md` — Dependencies

## License

MIT
