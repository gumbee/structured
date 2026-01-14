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
