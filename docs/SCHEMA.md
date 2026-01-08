# Schema

Zod extensions for flexible schema definitions with aliases, alternates, and dynamic resolution.

## API

This module extends Zod schemas with structured parsing capabilities. Import `z` from this package instead of directly from Zod to get the extensions.

```typescript
import { z } from "@gumbee/structured"
// or
import { z } from "@gumbee/structured/schema"
```

### .alias()

Add alternative field names for object properties. When parsing, any of these aliases can be used in place of the canonical field name.

```typescript
const UserSchema = z.object({
  name: z.string().alias(["username", "displayName"]),
  email: z.string().alias(["mail", "emailAddress"]),
})

// All of these parse to the same canonical form:
// Input: { "username": "alice", "mail": "a@example.com" }
// Output: { name: "alice", email: "a@example.com" }
```

Aliases work through wrapper types like `optional()` and `default()`:

```typescript
const Schema = z.object({
  title: z.string().optional().alias(["name"]).default("Untitled"),
})
```

### .alternate()

Add an alternative schema that can be transformed to the primary schema. When parsing, if the primary schema doesn't match, alternates are tried in order.

```typescript
const IconWidget = z
  .object({
    type: z.literal("icon"),
    icon: z.string(),
  })
  .alternate(
    z.string(), // Accept plain strings
    (v) => ({ type: "icon", icon: v }), // Transform to full object
  )

// Input: "home"
// Output: { type: 'icon', icon: 'home' }

// Input: { "type": "icon", "icon": "home" }
// Output: { type: 'icon', icon: 'home' }
```

Multiple alternates can be chained:

```typescript
const Widget = z
  .object({
    type: z.literal("widget"),
    value: z.number(),
  })
  .alternate(z.number(), (n) => ({ type: "widget", value: n }))
  .alternate(z.string(), (s) => ({ type: "widget", value: parseInt(s, 10) }))
```

### .flexible()

Add a normalizer function for flexible value matching. Values are compared using `normalizer(input) === normalizer(expected)`. Especially useful for case-insensitive literal matching.

```typescript
const SectionType = z.literal("section-header").flexible((v) => v.toLowerCase().replaceAll("-", "").replaceAll("_", ""))

// All of these match:
// "section-header", "Section-Header", "SectionHeader", "SECTION_HEADER"
```

### dynamic()

Create a dynamic schema that resolves from a registry at runtime. Acts like `z.any()` for validation but enables schema-based transformations when a registry is provided.

```typescript
import { dynamic } from "@gumbee/structured"

// Accept any widget from registry
const content = dynamic()

// Filter which schemas can match
const safeWidget = dynamic((entry) => entry.meta.id !== "error")
```

Common use case - dynamic arrays:

```typescript
const ListWidget = z.object({
  type: z.literal("list"),
  items: dynamic().array().optional(),
})
```

See [Describe](DESCRIBE.md) for setting up a registry.

## Combining Extensions

Extensions can be combined for powerful flexible parsing:

```typescript
const TextWidget = z
  .object({
    type: z.literal("text"),
    text: z.string().alias(["content", "value", "body"]),
  })
  .alternate(z.string(), (v) => ({ type: "text", text: v }))

const ListWidget = z.object({
  type: z.literal("list"),
  items: z
    .object({
      title: z.string().alias(["label", "name"]).optional(),
      content: dynamic()
        .array()
        .alternate(dynamic(), (v) => [v]) // Single item → array
        .alias(["items", "children"])
        .optional(),
    })
    .alternate(z.string(), (v) => ({ title: v })) // String → item object
    .array(),
})
```

## Helper Functions

**`getStructuredMeta(schema)`**

Get structured metadata from a Zod schema.

```typescript
import { getStructuredMeta } from "@gumbee/structured/schema"

const schema = z.string().alias(["name", "label"])
const meta = getStructuredMeta(schema)
// { aliases: ['name', 'label'], alternates: [], normalizer: undefined, ... }
```

**`hasStructuredMeta(schema)`**

Check if a schema has any structured metadata (aliases or alternates).

```typescript
import { hasStructuredMeta } from "@gumbee/structured/schema"

hasStructuredMeta(z.string()) // false
hasStructuredMeta(z.string().alias(["x"])) // true
```

**`buildAliasMap(schema)`**

Build a map of alias → canonical field name from an object schema.

```typescript
import { buildAliasMap } from "@gumbee/structured/schema"

const UserSchema = z.object({
  name: z.string().alias(["username"]),
  email: z.string().alias(["mail"]),
})

const aliasMap = buildAliasMap(UserSchema)
// Map { 'username' => 'name', 'mail' => 'email' }
```

**`isDynamicSchema(schema)`**

Check if a schema is marked as dynamic.

```typescript
import { isDynamicSchema, dynamic } from "@gumbee/structured/schema"

isDynamicSchema(z.any()) // false
isDynamicSchema(dynamic()) // true
```
