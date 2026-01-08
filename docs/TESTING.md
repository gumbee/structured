# Testing

Test setup and utilities for the structured package.

## Configuration

Tests use [Vitest](https://vitest.dev/) with a Node.js environment. The configuration is in `vitest.node.config.js`:

```javascript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
    globals: true,
  },
})
```

## Running Tests

```bash
# Run tests once
bun run test

# Run tests in watch mode
bun run test:watch

# Update snapshots
bun run test:update
```

## Test Structure

The package has three main test files:

| File                  | Coverage                                                    |
| :-------------------- | :---------------------------------------------------------- |
| `parser.test.ts`      | JSON parsing, signatures, preamble/postamble handling       |
| `resolver.test.ts`    | Schema resolution, aliases, alternates, dynamic schemas     |
| `progressive.test.ts` | Progressive parsing with metadata (`__done`, `__completed`) |

## Test Helpers

### chunkwise()

A helper function that simulates progressive parsing by processing text in chunks of a given size:

```typescript
const chunkwise = <T = any>(text: string, chunkSize: number, options: StructuredJsonOptions<T> = {}): T | undefined => {
  const parser = new StructuredJson<T>(options)

  for (let i = 0; i < text.length; i += chunkSize) {
    parser.process(text.slice(i, i + chunkSize))
  }

  parser.finish()
  return parser.value
}
```

This allows testing the parser's behavior at various chunk boundaries:

```typescript
// Test with different chunk sizes to catch edge cases
;[1, 2, 3, 4, 10, 20, 100, 200, 200000000].forEach((size) => {
  describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
    it("should parse correctly", () => {
      const result = chunkwise(JSON.stringify({ key: "value" }), size)
      expect(clean(result)).toEqual({ key: "value" })
    })
  })
})
```

### sorted()

A helper for order-agnostic array comparison:

```typescript
const sorted = <T>(arr: T[] | undefined | null): any => {
  if (!arr) return arr
  return [...arr].sort()
}

// Usage
expect(sorted(result?.__done)).toEqual(sorted(["type", "text"]))
```

### createRegistry()

A helper for creating minimal registries in resolver tests:

```typescript
function createRegistry(entries: DynamicRegistryEntry[]): DynamicRegistry {
  return {
    values: function* () {
      for (const entry of entries) {
        yield entry
      }
    },
  }
}

// Usage
const registry = createRegistry([
  { schema: TextWidget, meta: { id: "Text" } },
  { schema: ImageWidget, meta: { id: "Image" } },
])
```

## Testing Patterns

### Parser Tests

Test JSON parsing at various chunk sizes to ensure robustness:

```typescript
describe("StructuredJson Parser", () => {
  const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200, 200000000]

  describe("Basic JSON Parsing", () => {
    chunkSizes.forEach((size) => {
      it(`should parse nested objects (chunk size ${size})`, () => {
        const json = { user: { name: "Alice" } }
        const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
        expect(clean(value)).toEqual(json)
      })
    })
  })
})
```

### Resolver Tests

Test alias resolution, alternates, and dynamic schemas:

```typescript
describe("objects with aliases", () => {
  it("should resolve aliased fields to canonical names", () => {
    const schema = z.object({
      text: z.string().alias(["content", "value"]),
    })

    const result = tryResolveWith({ content: "hello" }, schema)
    expect(result?.output).toEqual({ text: "hello" })
  })
})

describe("alternate schemas", () => {
  it("should fallback to alternate when primary fails", () => {
    const schema = z
      .object({
        type: z.literal("text"),
        text: z.string(),
      })
      .alternate(z.string(), (v) => ({ type: "text", text: v }))

    const result = tryResolveWith("hello world", schema)
    expect(result?.output).toEqual({ type: "text", text: "hello world" })
  })
})
```

### Progressive Metadata Tests

Test that `__done` and `__completed` are set correctly:

```typescript
describe("Progressive metadata", () => {
  it("should set __done to canonical keys", () => {
    const schema = z.object({
      text: z.string().alias(["content"]),
    })

    const result = chunkwise('{"content": "hello"}', 1, { schema })

    // __done should contain canonical key 'text', not alias 'content'
    expect(sorted(result?.__done)).toEqual(sorted(["text"]))
    expect(result?.__completed).toBe(true)
  })
})
```

### Edge Cases

Test LLM quirks and non-standard JSON:

```typescript
describe("Edge Cases", () => {
  it("should handle single quote strings (LLM quirk)", () => {
    const input = "{'key': 'value'}"
    const { value } = chunkwise(input, 1, { skipPreamble: false })
    expect(clean(value)).toEqual({ key: "value" })
  })

  it("should handle trailing commas", () => {
    const input = '{"a": 1, "b": 2,}'
    const { value } = chunkwise(input, 1, { skipPreamble: false })
    expect(clean(value)).toHaveProperty("a", 1)
  })
})
```

## Writing New Tests

When adding tests:

1. **Use multiple chunk sizes** - Especially for parser tests, run the same test at different chunk sizes to catch boundary issues

2. **Test aliases with canonical output** - Always verify that `__done` contains canonical field names, not aliases

3. **Test alternates in both directions** - Verify that both primary and alternate forms resolve correctly

4. **Use `clean()` for value comparison** - Remove progressive metadata before comparing values

5. **Test with registries for dynamic schemas** - Dynamic resolution requires a registry to be meaningful

6. **Consider progressive mode** - When testing `__done` behavior, pass `progressive: true` to the resolver
