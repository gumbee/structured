# @gumbee/structured

<div align="left">

[![npm version](https://img.shields.io/npm/v/@gumbee/structured.svg)](https://www.npmjs.com/package/@gumbee/structured)
[![License](https://img.shields.io/npm/l/@gumbee/structured.svg)](package.json)

</div>

@gumbee/structured is a schema-aware progressive JSON parser that builds structured objects from streamed text. It extends Zod with alias and alternate schema support for flexible parsing, making it ideal for parsing LLM outputs in real-time.

While this package is intended for internal use within the Gumbee ecosystem, it is published publicly and can be used in other projects if found useful.

## Installation

```bash
bun add @gumbee/structured
# npm install @gumbee/structured
# pnpm add @gumbee/structured
# yarn add @gumbee/structured
```

## Quick Start

```typescript
import { z, StructuredJson, clean } from "@gumbee/structured"

// Define schema with aliases and alternates
const Icon = z
  .object({
    type: z.literal("icon"),
    icon: z.string().alias(["name"]), // 'name' can be used instead of 'icon'
  })
  .alternate(
    z.string(), // Accept plain strings
    (v) => ({ type: "icon", icon: v }), // Transform to full object
  )

// Parse progressively
const parser = new StructuredJson({
  schema: Icon,
  onComplete: (result) => console.log(clean(result)),
})

// Stream in chunks
parser.process('{"na')
parser.process('me": "home"}')
// Output: { type: 'icon', icon: 'home' }
```

## Documentation

- [Parser](docs/PARSER.md) - Progressive JSON parsing with `StructuredJson` class
- [Schema](docs/SCHEMA.md) - Zod extensions for aliases, alternates, and dynamic schemas
- [Describe](docs/DESCRIBE.md) - Schema registry and TypeScript generation utilities
- [Testing](docs/TESTING.md) - Test setup and utilities

## Entry Points

The package provides multiple entry points for different use cases:

| Entry Point                   | Use Case                                                       |
| :---------------------------- | :------------------------------------------------------------- |
| `@gumbee/structured`          | Full package with parser, schema extensions, and utilities     |
| `@gumbee/structured/schema`   | Lightweight Zod extensions only (no parser)                    |
| `@gumbee/structured/describe` | Schema registry and TypeScript generation (build-time tooling) |

## Configuration

By default, `StructuredJson` enables `skipPreamble` which automatically skips text before JSON content (e.g., markdown code fences, explanatory text). The parser looks for `{`, `[`, or ` ```structured` to start parsing (code fence language configurable). Set `skipPreamble: false` for direct JSON parsing.

## Development

For build information, check the `package.json` scripts.
This package is part of the Gumbee ecosystem of packages used by myself to build various personal projects and ideas.

To report bugs or submit patches please use [GitHub issues](https://github.com/gumbee/structured/issues).

## Releasing

This package uses [changesets](https://github.com/changesets/changesets) for version management and GitHub Actions for automated publishing.

### Creating a Changeset

When you make changes that should be released, create a changeset:

```bash
bun changeset
```

This will prompt you to:

1. Select the type of change (patch, minor, major)
2. Write a summary of the changes

Commit the generated changeset file (in `.changeset/`) with your changes.

### Publishing a Release

When ready to release:

```bash
# 1. Apply changesets to bump version and update CHANGELOG
bun run version

# 2. Commit the version bump
git add .
git commit -m "chore: release v1.x.x"

# 3. Create and push the tag
git tag v1.x.x
git push origin main --tags
```

The GitHub Actions workflow will automatically build, test, and publish to npm when the tag is pushed.
