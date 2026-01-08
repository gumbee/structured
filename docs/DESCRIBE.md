# Describe

Schema registry and TypeScript generation utilities for build-time tooling.

## API

This module provides tools for managing collections of schemas and generating TypeScript type definitions. It's primarily used for build-time/dev-time tooling.

```typescript
import { DescribeRegistry, registryToTypescript } from "@gumbee/structured/describe"
import { z } from "@gumbee/structured/schema"
```

### DescribeRegistry

A registry for collecting and managing Zod schemas with metadata.

**Creating a Registry**

```typescript
const registry = new DescribeRegistry()
```

**Adding Schemas**

```typescript
const UserSchema = z.object({
  name: z.string(),
  email: z.string(),
})

registry.add(UserSchema, {
  id: "user",
  description: "A user in the system",
  aliases: ["person", "account"],
})
```

### DescribeMeta

Metadata interface for registered schemas:

```typescript
interface DescribeMeta {
  /** Unique identifier for this schema (required) */
  id: string
  /** Human-readable description of the schema */
  description?: string
  /** Alternative names that can reference this schema */
  aliases?: string[]
  /** IDs of schemas this schema depends on */
  dependencies?: string[]
  /** If true, always include this schema in output */
  always?: boolean
  /** If true, this is a utility type (not exported as top-level) */
  utility?: boolean
  /** Additional rules/constraints for LLM prompts */
  rules?: string
}
```

### Registry Methods

**`add(schema, meta)`**

Register a schema with metadata. Returns `this` for chaining.

```typescript
registry.add(UserSchema, { id: "user", description: "A user" }).add(PostSchema, { id: "post", description: "A blog post" })
```

**`get(id)`**

Get a schema entry by ID or alias.

```typescript
const entry = registry.get("user")
// { schema: ZodObject, meta: { id: 'user', ... } }
```

**`getSchema(id)`**

Get just the schema by ID or alias.

```typescript
const schema = registry.getSchema("user")
```

**`getMeta(id)`**

Get just the metadata by ID or alias.

```typescript
const meta = registry.getMeta("user")
// { id: 'user', description: 'A user', ... }
```

**`has(id)`**

Check if a schema is registered by ID or alias.

```typescript
registry.has("user") // true
registry.has("person") // true (alias)
registry.has("unknown") // false
```

**`hasSchema(schema)`**

Check if a schema instance is registered.

```typescript
registry.hasSchema(UserSchema) // true
```

**`getIdForSchema(schema)`**

Get the ID for a registered schema instance.

```typescript
registry.getIdForSchema(UserSchema) // 'user'
```

**`remove(id)`**

Remove a schema by ID. Returns `true` if removed.

```typescript
registry.remove("user") // true
```

**`clear()`**

Clear all registered schemas.

```typescript
registry.clear()
```

### Iteration Methods

**`values()`**

Iterate over unique schema entries (excludes alias duplicates).

```typescript
for (const entry of registry.values()) {
  console.log(entry.meta.id, entry.schema)
}
```

**`entries()`**

Iterate over unique entries as `[id, entry]` pairs.

```typescript
for (const [id, entry] of registry.entries()) {
  console.log(id, entry.meta.description)
}
```

**`ids()`**

Iterate over unique schema IDs.

```typescript
const allIds = [...registry.ids()]
```

**`size`**

Get the number of unique schemas.

```typescript
console.log(registry.size) // 2
```

## TypeScript Generation

Generate TypeScript type definitions from registered schemas.

**`registryToTypescript(registry)`**

Convert all schemas in a registry to TypeScript type definitions.

```typescript
import { registryToTypescript } from "@gumbee/structured/describe"

const typescript = registryToTypescript(registry)
console.log(typescript)
```

Output:

```typescript
/**
 * A user in the system
 */
type User = {
  name: string
  email: string
}

/**
 * A blog post
 */
type Post = {
  title: string
  content: string
  author: User
}
```

**`schemaToTypescript(registry, schema)`**

Convert a single schema to a TypeScript type string.

```typescript
import { schemaToTypescript } from "@gumbee/structured/describe"

const typeString = schemaToTypescript(registry, UserSchema)
// "{\n  name: string\n  email: string\n}"
```

**`toTypescript()`** (instance method)

Convenience method on registry.

```typescript
const typescript = registry.toTypescript()
```

## Dependency Collection

Collect and manage schema dependencies for generating minimal type subsets.

**`collectSchemaDependencies(schemaIds, registry)`**

Collect all dependencies for the given schema IDs.

```typescript
import { collectSchemaDependencies } from "@gumbee/structured/describe"

// If PostSchema references UserSchema
const allIds = collectSchemaDependencies(["post"], registry)
// ['post', 'user']
```

**`collectDependencies(schemaIds)`** (instance method)

```typescript
const allIds = registry.collectDependencies(["post"])
```

**`subset(schemaIds)`**

Create a new registry containing only the specified schemas and their dependencies.

```typescript
// Create minimal registry for 'post' and its dependencies
const minimalRegistry = registry.subset(["post"])
const typescript = minimalRegistry.toTypescript()
```

## Integration with Parser

Use the registry with `StructuredJson` for dynamic schema resolution:

```typescript
import { StructuredJson, dynamic, clean } from "@gumbee/structured"
import { DescribeRegistry } from "@gumbee/structured/describe"

// Define and register schemas
const TextWidget = z.object({
  type: z.literal("text"),
  text: z.string(),
})

const ImageWidget = z.object({
  type: z.literal("image"),
  src: z.string(),
})

const registry = new DescribeRegistry()
registry.add(TextWidget, { id: "text", description: "Text content" })
registry.add(ImageWidget, { id: "image", description: "An image" })

// Parse with dynamic resolution
const parser = new StructuredJson({
  schema: dynamic(),
  registry,
  onComplete: (result) => console.log(clean(result)),
})

parser.process('{"type": "text", "text": "Hello"}')
// Output: { type: 'text', text: 'Hello' }
```

## Use Cases

### LLM Prompt Generation

Generate TypeScript definitions to include in LLM prompts:

```typescript
const widgetRegistry = new DescribeRegistry()
widgetRegistry.add(TextWidget, {
  id: "text",
  description: "A text widget for displaying content",
  rules: "Use for paragraphs, headings, and inline text",
})

const prompt = `
You are generating UI widgets. Available types:

${widgetRegistry.toTypescript()}

Return JSON matching one of these types.
`
```

### Build-time Type Generation

Generate type files during build:

```typescript
import { writeFileSync } from "fs"

const types = registry.toTypescript()
writeFileSync("generated/widget-types.ts", types)
```

### Minimal Type Subsets

Generate only the types needed for a specific feature:

```typescript
// Only include 'dashboard' widget and its dependencies
const dashboardRegistry = registry.subset(["dashboard"])
const dashboardTypes = dashboardRegistry.toTypescript()
```
