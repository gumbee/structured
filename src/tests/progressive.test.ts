import { describe, it, expect } from "vitest"
import { z, StructuredJson, clean, type StructuredJsonOptions, dynamic, type Progressive } from "@/index"
import { DescribeRegistry } from "@/describe"

const chunkwise = <T = any>(text: string, chunkSize: number, options: StructuredJsonOptions<T> = {}): T | undefined => {
  const parser = new StructuredJson<T>(options)

  for (let i = 0; i < text.length; i += chunkSize) {
    parser.process(text.slice(i, i + chunkSize))
  }

  parser.finish()

  return parser.value
}

/**
 * Returns a sorted copy of an array for order-agnostic comparison
 */
const sorted = <T>(arr: T[] | undefined | null): any => {
  if (!arr) return arr

  return [...arr].sort()
}

const TextWidget = z
  .object({
    type: z.literal("text"),
    text: z.string().alias(["value", "content"]),
  })
  .alternate(z.string(), (v) => ({ type: "text", text: v }))

const ListWidget = z.object({
  type: z.literal("list"),
  items: z
    .object({
      title: z.string().alias(["label", "name"]).optional(),
      content: dynamic()
        .array()
        .alternate(dynamic(), (v) => [v])
        .alias(["items", "children"])
        .optional(),
    })
    .alternate(z.string(), (v) => ({ title: v })) // string element → single object
    .array(),
})

type TextWidget = z.infer<typeof TextWidget>
type ListWidget = z.infer<typeof ListWidget>

const registry = new DescribeRegistry()

registry.add(TextWidget, { id: "text", description: "A text widget" })
registry.add(ListWidget, { id: "list", description: "A list widget" })

/**
 * Tests for progressive metadata types (__done, __completed)
 * Ensures that __done contains canonical keys from the primary schema,
 * not aliases or alternate schema keys.
 */

describe("Parser", () => {
  ;[1, 2, 3, 4, 10, 20, 100, 200, 200000000].forEach((size) => {
    describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
      it(`should parse a simple valid schema`, () => {
        const text: TextWidget = { text: "Hello, world!", type: "text" }

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, { registry })

        expect(clean(result)).toEqual(text)
        expect(sorted(result?.__done)).toEqual(sorted(["type", "text"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should parse a simple invalid schema`, () => {
        const invalid = { dream: true }

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(invalid), size, { registry, skipPreamble: false })

        expect(clean(result)).toEqual(invalid)
        expect(sorted(result?.__done)).toEqual(sorted(["dream"]))
        expect(result?.__completed).toBe(true)
      })

      // spacing comment
      ;[1, "hello world", true, false, null].forEach((value: any) => {
        it(`should parse primitive values of type ${typeof value}`, () => {
          const result: Progressive<string> | undefined = chunkwise(JSON.stringify(value), size, { skipPreamble: false })

          expect(clean(result)).toEqual(value)
        })

        it(`should NOT parse primitive values of type ${typeof value} with skipPreamble: true`, () => {
          const result: Progressive<string> | undefined = chunkwise(JSON.stringify(value), size, { skipPreamble: true })

          expect(clean(result)).toEqual(undefined)
        })

        it(`should NOT parse primitive values of type ${typeof value} per default`, () => {
          const result: Progressive<string> | undefined = chunkwise(JSON.stringify(value), size)

          expect(clean(result)).toEqual(undefined)
        })
      })

      //need to handle undefined differently
      it(`should parse primitive values of undefined`, () => {
        const result: Progressive<undefined> | undefined = chunkwise("undefined", size, { skipPreamble: false })

        expect(clean(result)).toEqual(undefined)
      })

      it(`should NOT parse primitive values of undefined with skipPreamble: true`, () => {
        const result: Progressive<undefined> | undefined = chunkwise("undefined", size, { skipPreamble: true })

        expect(clean(result)).toEqual(undefined)
      })

      it(`should NOT parse primitive values of undefined per default`, () => {
        const result: Progressive<undefined> | undefined = chunkwise("undefined", size)

        expect(clean(result)).toEqual(undefined)
      })

      it(`should resolve aliases`, () => {
        const text = { type: "text", value: "Hello, world!" }

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, { registry })

        expect(clean(result)).toEqual({ type: "text", text: text.value })
        expect(sorted(result?.__done)).toEqual(sorted(["type", "text"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should resolve aliases regardless of order`, () => {
        const text = { value: "Hello, world!", type: "text" }

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, { registry })

        expect(clean(result)).toEqual({ type: "text", text: text.value })
        expect(sorted(result?.__done)).toEqual(sorted(["type", "text"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should resolve aliases with a schema`, () => {
        const schema = z.object({
          dream: z.string().alias(["imagination", "vision"]),
        })
        const text = { vision: "Hello, world!" }

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, { schema })

        expect(clean(result)).toEqual({ dream: text.vision })
        expect(sorted(result?.__done)).toEqual(sorted(["dream"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should resolve alternates with a schema`, () => {
        const schema = z
          .object({
            dream: z.string().alias(["imagination", "vision"]),
          })
          .alternate(z.string(), (v) => ({ dream: v }))

        const text = "Supervision"

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, { schema, skipPreamble: false })

        expect(clean(result)).toEqual({ dream: text })
        expect(sorted(result?.__done)).toEqual(sorted(["dream"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should resolve alternates with a registry`, () => {
        const text = "What is the meaning of life?"

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, { registry, skipPreamble: false })

        expect(clean(result)).toEqual({ type: "text", text: text })
        expect(sorted(result?.__done)).toEqual(sorted(["type", "text"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should resolve dynamic()`, () => {
        const text = "What is the meaning of life?"

        const result: Progressive<TextWidget> | undefined = chunkwise(JSON.stringify(text), size, {
          schema: dynamic(),
          registry,
          skipPreamble: false,
        })

        expect(clean(result)).toEqual({ type: "text", text: text })
        expect(sorted(result?.__done)).toEqual(sorted(["type", "text"]))
        expect(result?.__completed).toBe(true)
      })

      it(`should resolve nested dynamic() and consider aliases and alternates`, () => {
        const list = {
          type: "list",
          items: [
            { title: "Item 1", items: "Content 1" },
            {
              title: "Item 2",
              content: [
                {
                  type: "text",
                  text: "Content 2",
                },
              ],
            },
            {
              content: "Item 3",
            },
            "Item 4",
          ],
        }

        const result: Progressive<ListWidget> | undefined = chunkwise(JSON.stringify(list), size, { schema: dynamic(), registry })

        expect(clean(result)).toEqual({
          type: "list",
          items: [
            { title: "Item 1", content: [{ type: "text", text: "Content 1" }] },
            { title: "Item 2", content: [{ type: "text", text: "Content 2" }] },
            { content: [{ type: "text", text: "Item 3" }] },
            { title: "Item 4" },
          ],
        })
        expect(sorted(result?.__done)).toEqual(sorted(["type", "items"]))
        expect(result?.__completed).toBe(true)
      })
    })

    it(`should handle optionals correctly with aliases and alternates`, () => {
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
        })
        .alternate(z.object({ icon: z.string().alias(["supericon"]) }), (v) => ({ type: "icon", icon: v.icon }))

      const HeaderWidget = z
        .object({
          type: z.literal("header"),
          title: z.string(),
          icon: IconWidget.optional(),
        })
        .alternate(z.object({ title: z.string() }), (v) => ({ type: "header", title: v.title }))

      // Create a local registry with the local schemas
      const localRegistry = new DescribeRegistry()
      localRegistry.add(IconWidget, { id: "icon", description: "An icon widget" })
      localRegistry.add(HeaderWidget, { id: "header", description: "A header widget" })

      const header = {
        type: "header",
        title: "Hello, world!",
        icon: {
          supericon: "boat",
        },
      }

      const result: Progressive<typeof HeaderWidget> | undefined = chunkwise(JSON.stringify(header), size, {
        schema: dynamic(),
        registry: localRegistry,
      })

      expect(clean(result)).toEqual({
        type: "header",
        title: header.title,
        icon: { type: "icon", icon: "boat" }, // 'supericon' alias resolved to 'icon', value is 'boat'
      })
      expect(sorted(result?.__done)).toEqual(sorted(["type", "title", "icon"]))
      expect(result?.__completed).toBe(true)
    })
  })
})

/**
 * Tests for progressive preamble emission across different chunk sizes.
 * Ensures that preamble text is emitted progressively as chunks arrive,
 * and signature prefixes are correctly held back.
 */
describe("Progressive Preamble Emission", () => {
  const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200]

  /**
   * Calculate the expected minimum number of preamble chunks based on chunk size.
   * With progressive emission, we expect approximately ceil(preambleLength / chunkSize) emissions,
   * but some may be held back due to potential signature prefixes (up to 6 chars for ```jso).
   * For large chunk sizes (>= preambleLength), we expect at least 1 emission.
   */
  const getExpectedMinChunks = (preambleLength: number, chunkSize: number): number => {
    if (chunkSize >= preambleLength) {
      return 1
    }
    // Account for held-back prefix (up to 6 chars) reducing emissions slightly
    const maxHeldBack = 6
    const effectiveEmissions = Math.max(1, Math.ceil((preambleLength - maxHeldBack) / chunkSize))
    return effectiveEmissions
  }

  chunkSizes.forEach((size) => {
    describe(`chunk size ${size}`, () => {
      it("should emit preamble progressively and parse JSON correctly", () => {
        const preambleText = "Here is the JSON response:\n"
        const json = { message: "hello", count: 42 }
        const input = preambleText + JSON.stringify(json)
        const preambleChunks: string[] = []

        const parser = new StructuredJson({
          skipPreamble: true,
          registry,
          onPreamble: (text) => preambleChunks.push(text),
        })

        for (let i = 0; i < input.length; i += size) {
          parser.process(input.slice(i, i + size))
        }
        parser.finish()

        // All chunks together should form the full preamble
        expect(preambleChunks.join("")).toBe(preambleText)
        // JSON should be parsed correctly
        expect(clean(parser.value)).toEqual(json)

        // Verify chunk count matches expected based on chunk size
        const expectedMinChunks = getExpectedMinChunks(preambleText.length, size)
        expect(preambleChunks.length).toBeGreaterThanOrEqual(expectedMinChunks)

        // For small chunk sizes, verify we got multiple emissions (true progressive behavior)
        if (size < preambleText.length / 2) {
          expect(preambleChunks.length).toBeGreaterThan(1)
        }
      })

      it("should hold back backtick prefixes that could be ```json", () => {
        const preambleText = "Check this out: `code` and more text "
        const json = { data: true }
        const input = preambleText + JSON.stringify(json)
        const preambleChunks: string[] = []

        const parser = new StructuredJson({
          skipPreamble: true,
          onPreamble: (text) => preambleChunks.push(text),
        })

        for (let i = 0; i < input.length; i += size) {
          parser.process(input.slice(i, i + size))
        }
        parser.finish()

        // Full preamble should be emitted (backticks that aren't ```json)
        expect(preambleChunks.join("")).toBe(preambleText)
        expect(clean(parser.value)).toEqual(json)

        // Verify chunk count is proportional to chunk size
        const expectedMinChunks = getExpectedMinChunks(preambleText.length, size)
        expect(preambleChunks.length).toBeGreaterThanOrEqual(expectedMinChunks)
      })

      it("should work with ```json code fence", () => {
        const preambleText = "Here is the code:\n"
        const json = { fenced: true }
        const input = preambleText + "```json\n" + JSON.stringify(json) + "\n```"
        const preambleChunks: string[] = []

        const parser = new StructuredJson({
          skipPreamble: true,
          onPreamble: (text) => preambleChunks.push(text),
        })

        for (let i = 0; i < input.length; i += size) {
          parser.process(input.slice(i, i + size))
        }
        parser.finish()

        // Preamble should be text before ```json (not including the fence)
        expect(preambleChunks.join("")).toBe(preambleText)
        expect(clean(parser.value)).toEqual(json)

        // Verify chunk count is proportional to chunk size
        const expectedMinChunks = getExpectedMinChunks(preambleText.length, size)
        expect(preambleChunks.length).toBeGreaterThanOrEqual(expectedMinChunks)
      })

      it("should emit preamble progressively in multiple mode", () => {
        const json1 = { first: 1 }
        const json2 = { second: 2 }
        const preamble1 = "First:\n"
        const preamble2 = "\nSecond:\n"
        const input = preamble1 + JSON.stringify(json1) + preamble2 + JSON.stringify(json2)

        const preambleChunks: string[] = []
        const completedValues: unknown[] = []
        const segments: string[] = []
        let currentSegment = ""

        const parser = new StructuredJson({
          skipPreamble: true,
          multiple: true,
          onPreamble: (text) => {
            preambleChunks.push(text)
            currentSegment += text
          },
          onComplete: (json) => {
            completedValues.push(json)
            if (currentSegment) {
              segments.push(currentSegment)
              currentSegment = ""
            }
          },
        })

        for (let i = 0; i < input.length; i += size) {
          parser.process(input.slice(i, i + size))
        }
        parser.finish()

        // Both JSON values should be parsed
        expect(completedValues.length).toBe(2)
        expect(clean(completedValues[0])).toEqual(json1)
        expect(clean(completedValues[1])).toEqual(json2)

        // Preamble segments should match
        expect(segments.length).toBe(2)
        expect(segments[0]).toBe(preamble1)
        expect(segments[1]).toBe(preamble2)

        // Verify total chunk count across both segments
        const totalPreambleLength = preamble1.length + preamble2.length
        const expectedMinChunks = getExpectedMinChunks(totalPreambleLength, size)
        expect(preambleChunks.length).toBeGreaterThanOrEqual(expectedMinChunks)

        // For small chunk sizes, verify we got multiple emissions
        if (size < totalPreambleLength / 2) {
          expect(preambleChunks.length).toBeGreaterThan(1)
        }
      })

      it("should emit trailing text progressively when no more JSON in multiple mode", () => {
        const json = { only: 1 }
        const trailingText = "\n\nNo more JSON here!"
        const input = JSON.stringify(json) + trailingText

        const preambleChunks: string[] = []
        const completedValues: unknown[] = []

        const parser = new StructuredJson({
          skipPreamble: true,
          multiple: true,
          onPreamble: (text) => preambleChunks.push(text),
          onComplete: (json) => completedValues.push(json),
        })

        for (let i = 0; i < input.length; i += size) {
          parser.process(input.slice(i, i + size))
        }
        parser.finish()

        expect(completedValues.length).toBe(1)
        expect(clean(completedValues[0])).toEqual(json)
        // Trailing text should be emitted as preamble
        expect(preambleChunks.join("")).toBe(trailingText)

        // Verify chunk count is proportional to chunk size
        const expectedMinChunks = getExpectedMinChunks(trailingText.length, size)
        expect(preambleChunks.length).toBeGreaterThanOrEqual(expectedMinChunks)
      })

      it("should work with dynamic schema and registry", () => {
        const preambleText = "Widget response:\n"
        const widget = { type: "text", text: "Hello world" }
        const input = preambleText + JSON.stringify(widget)
        const preambleChunks: string[] = []

        const parser = new StructuredJson({
          skipPreamble: true,
          schema: dynamic(),
          registry,
          onPreamble: (text) => preambleChunks.push(text),
        })

        for (let i = 0; i < input.length; i += size) {
          parser.process(input.slice(i, i + size))
        }
        parser.finish()

        expect(preambleChunks.join("")).toBe(preambleText)
        expect(clean(parser.value)).toEqual(widget)

        // Verify chunk count is proportional to chunk size
        const expectedMinChunks = getExpectedMinChunks(preambleText.length, size)
        expect(preambleChunks.length).toBeGreaterThanOrEqual(expectedMinChunks)
      })
    })
  })

  /**
   * Snapshot tests for exact chunk emissions.
   * These serve as a final defense against regressions in progressive emission behavior.
   */
  describe("Snapshot Tests", () => {
    it("should match snapshot for chunk size 1", () => {
      const preambleText = "Hello world! "
      const input = preambleText + '{"x": 1}'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (let i = 0; i < input.length; i += 1) {
        parser.process(input.slice(i, i + 1))
      }
      parser.finish()

      expect(preambleChunks).toMatchSnapshot()
    })

    it("should match snapshot for chunk size 2", () => {
      const preambleText = "Hello world! "
      const input = preambleText + '{"x": 1}'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (let i = 0; i < input.length; i += 2) {
        parser.process(input.slice(i, i + 2))
      }
      parser.finish()

      expect(preambleChunks).toMatchSnapshot()
    })

    it("should match snapshot for chunk size 5", () => {
      const preambleText = "Hello world! "
      const input = preambleText + '{"x": 1}'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (let i = 0; i < input.length; i += 5) {
        parser.process(input.slice(i, i + 5))
      }
      parser.finish()

      expect(preambleChunks).toMatchSnapshot()
    })

    it("should match snapshot for backtick handling with chunk size 3", () => {
      const preambleText = "Use `code` here "
      const input = preambleText + '{"y": 2}'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (let i = 0; i < input.length; i += 3) {
        parser.process(input.slice(i, i + 3))
      }
      parser.finish()

      expect(preambleChunks).toMatchSnapshot()
    })

    it("should match snapshot for multiple JSON with chunk size 4", () => {
      const input = 'First: {"a": 1}\nSecond: {"b": 2}'
      const preambleChunks: string[] = []
      const completedJsons: unknown[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        multiple: true,
        onPreamble: (text) => preambleChunks.push(text),
        onComplete: (json) => completedJsons.push(json),
      })

      for (let i = 0; i < input.length; i += 4) {
        parser.process(input.slice(i, i + 4))
      }
      parser.finish()

      expect({ preambleChunks, completedJsons: completedJsons.map(clean) }).toMatchSnapshot()
    })

    it("should match snapshot for code fence with chunk size 3", () => {
      const preambleText = "Response:\n"
      const input = preambleText + '```json\n{"fenced": true}\n```'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (let i = 0; i < input.length; i += 3) {
        parser.process(input.slice(i, i + 3))
      }
      parser.finish()

      expect(preambleChunks).toMatchSnapshot()
    })
  })
})
