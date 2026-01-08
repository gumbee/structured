# Parser

Progressive JSON parsing with schema-aware value construction.

## API

The parser processes JSON text incrementally, building structured objects as data streams in. It's designed for parsing LLM outputs in real-time while providing partial results during streaming.

### StructuredJson

The main parser class for progressive JSON parsing.

**Constructor Options**

```typescript
interface StructuredJsonOptions<T> {
  /** Schema to validate and guide parsing */
  schema?: z.ZodType<T>
  /** Called when a complete JSON value is parsed */
  onComplete?: (json: T, remainder: string) => void
  /** Called when parsing encounters an error */
  onError?: (error: Error) => void
  /** Skip preamble text before JSON content (default: true) */
  skipPreamble?: boolean
  /** Called when preamble text is found before JSON starts */
  onPreamble?: (text: string) => void
  /** Registry for dynamic schema resolution */
  registry?: DynamicRegistry
}
```

**Basic Usage**

```typescript
import { z, StructuredJson, clean } from "@gumbee/structured"

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
})

const parser = new StructuredJson({
  schema: UserSchema,
  onComplete: (result) => console.log("Done:", clean(result)),
})

// Stream chunks as they arrive
parser.process('{"name": "Al')
parser.process('ice", "age": 30}')
// Output: Done: { name: 'Alice', age: 30 }
```

### Methods

**`process(chunk: string)`**

Process a chunk of JSON text. When `skipPreamble` is enabled (default), automatically skips preamble text before JSON content.

```typescript
parser.process('Here is the JSON: {"key": "value"}')
// Skips "Here is the JSON: " and parses the object
```

**`finish()`**

Signal end of input. Forces completion of parsers that need explicit termination (e.g., numbers at the end of input).

```typescript
parser.process("42")
parser.finish() // Completes number parsing
```

**`reset()`**

Reset the parser to initial state for reuse.

```typescript
parser.process('{"a": 1}')
parser.reset()
parser.process('{"b": 2}') // Fresh parse
```

### Properties

**`value: T | undefined`**

Get the current partial value being parsed. Available during streaming before completion.

```typescript
parser.process('{"name": "Al')
console.log(parser.value) // { name: 'Al', __done: ['name'], __completed: false }
```

**`done: boolean`**

Check if parsing is complete.

```typescript
parser.process('{"done": true}')
console.log(parser.done) // true
```

**`error: boolean`**

Check if parsing encountered an error.

**`wasIncomplete: boolean`**

Check if parsing finished with incomplete input (via `finish()`).

## Progressive Values

During streaming, partial objects include tracking metadata:

- `__done: string[]` - Array of completed field names (canonical names, not aliases)
- `__completed: boolean` - Whether the object/array is fully parsed

```typescript
const parser = new StructuredJson({ schema: UserSchema })

parser.process('{"name": "Alice')
console.log(parser.value)
// { name: 'Alice', __done: ['name'], __completed: false }

parser.process('", "age": 30}')
console.log(parser.value)
// { name: 'Alice', age: 30, __done: ['name', 'age'], __completed: true }
```

## clean()

Remove progressive tracking properties from parsed values.

```typescript
import { clean } from "@gumbee/structured"

const result = { name: "Alice", __done: ["name"], __completed: true }
console.log(clean(result))
// { name: 'Alice' }
```

Works recursively on nested objects and arrays:

```typescript
const nested = {
  user: { name: "Alice", __done: ["name"], __completed: true },
  items: [{ id: 1, __done: ["id"], __completed: true }],
  __done: ["user", "items"],
  __completed: true,
}

console.log(clean(nested))
// { user: { name: 'Alice' }, items: [{ id: 1 }] }
```

## Preamble Handling

When `skipPreamble` is enabled (default), the parser automatically skips text before JSON:

````typescript
const parser = new StructuredJson({
  skipPreamble: true,
  onPreamble: (text) => console.log("Skipped:", text),
  onComplete: (json) => console.log("Parsed:", json),
})

parser.process('Here is the response:\n\n```json\n{"result": 42}\n```')
// Skipped: Here is the response:
// Parsed: { result: 42 }
````

The parser recognizes these JSON signatures:

- `{` - Object start
- `[` - Array start
- ` ```json` - Markdown code fence

Set `skipPreamble: false` for direct JSON parsing without preamble detection.

## Using with Registry

For dynamic schema resolution, provide a registry:

```typescript
import { StructuredJson, dynamic } from "@gumbee/structured"
import { DescribeRegistry } from "@gumbee/structured/describe"

const registry = new DescribeRegistry()
registry.add(TextWidget, { id: "text" })
registry.add(ImageWidget, { id: "image" })

const parser = new StructuredJson({
  schema: dynamic(), // Resolve from registry
  registry,
  onComplete: (result) => console.log(clean(result)),
})

// Parser will match against registry schemas
parser.process('{"type": "text", "content": "Hello"}')
```

See [Schema](SCHEMA.md) for details on `dynamic()` and [Describe](DESCRIBE.md) for `DescribeRegistry`.
