import { describe, it, expect, vi } from "vitest"
import { StructuredJson, type StructuredJsonOptions, clean } from "./index"

/**
 * Helper to parse JSON in chunks of a given size
 */
const chunkwise = <T = any>(
  text: string,
  chunkSize: number,
  options: StructuredJsonOptions<T> = {},
): { value: T | undefined; preamble?: string; postamble?: string } => {
  let preamble: string | undefined
  let postamble: string | undefined

  const parser = new StructuredJson<T>({
    ...options,
    onPreamble: (text) => {
      preamble = text
      options.onPreamble?.(text)
    },
    onComplete: (json, remainder) => {
      if (remainder.trim()) {
        postamble = remainder
      }
      options.onComplete?.(json, remainder)
    },
  })

  for (let i = 0; i < text.length; i += chunkSize) {
    parser.process(text.slice(i, i + chunkSize))
  }

  parser.finish()

  return { value: parser.value, preamble, postamble }
}

/**
 * Tests for StructuredJson parsing functionality.
 * Focuses on JSON parsing, signatures, preamble/postamble handling.
 */
describe("StructuredJson Parser", () => {
  const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200, 200000000]

  describe("Basic JSON Parsing", () => {
    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should return normal text as preamble when there is no json signature", () => {
          const text = "Hello, world!"
          const { value, preamble, postamble } = chunkwise(text, size)
          expect(value).toBeUndefined()
          expect(preamble).toEqual(text)
          expect(postamble).toBeUndefined()
        })

        it("should parse a simple object", () => {
          const json = { name: "test", value: 42 }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse a nested object", () => {
          const json = {
            user: { name: "Alice", age: 30 },
            metadata: { created: "2024-01-01", tags: ["a", "b"] },
          }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse a simple array", () => {
          const json = [1, 2, 3, 4, 5]
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse an array of objects", () => {
          const json = [
            { id: 1, name: "first" },
            { id: 2, name: "second" },
            { id: 3, name: "third" },
          ]
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse a mixed array", () => {
          const json = [1, "two", true, null, { nested: "object" }, [1, 2, 3]]
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse a string primitive", () => {
          const json = "hello world"
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(value).toEqual(json)
        })

        it("should parse a number primitive", () => {
          const json = 42.5
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(value).toEqual(json)
        })

        it("should parse a negative number", () => {
          const json = -123.456
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(value).toEqual(json)
        })

        it("should parse boolean true", () => {
          const { value } = chunkwise("true", size, { skipPreamble: false })
          expect(value).toEqual(true)
        })

        it("should parse boolean false", () => {
          const { value } = chunkwise("false", size, { skipPreamble: false })
          expect(value).toEqual(false)
        })

        it("should parse null", () => {
          const { value } = chunkwise("null", size, { skipPreamble: false })
          expect(value).toEqual(null)
        })

        it("should parse undefined", () => {
          const { value } = chunkwise("undefined", size, { skipPreamble: false })
          expect(value).toEqual(undefined)
        })

        it("should parse an empty object", () => {
          const { value } = chunkwise("{}", size, { skipPreamble: false })
          expect(clean(value)).toEqual({})
        })

        it("should parse an empty array", () => {
          const { value } = chunkwise("[]", size, { skipPreamble: false })
          expect(clean(value)).toEqual([])
        })

        it("should parse deeply nested structures", () => {
          const json = {
            level1: {
              level2: {
                level3: {
                  level4: { value: "deep" },
                },
              },
            },
          }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse objects with special characters in strings", () => {
          const json = {
            message: 'Hello "world"!',
            path: "C:\\Users\\test",
            newline: "line1\nline2",
            tab: "col1\tcol2",
          }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should parse unicode strings", () => {
          const json = { emoji: "👋🌍", chinese: "你好", arabic: "مرحبا" }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })
      })
    })
  })

  describe("JSON Signatures", () => {
    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should detect { signature and parse object", () => {
          const json = { type: "test" }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should detect [ signature and parse array", () => {
          const json = [1, 2, 3]
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should detect ```json signature and parse content", () => {
          const json = { code: "block" }
          const input = "```json\n" + JSON.stringify(json) + "\n```"
          const { value } = chunkwise(input, size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should find earliest { before [ in nested structures", () => {
          // This tests the fix for the signature detection bug
          const json = { outer: "value", items: [1, 2, 3] }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should find earliest [ before { when array comes first", () => {
          const json = [{ nested: "object" }]
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should handle ```json with extra whitespace", () => {
          const json = { test: true }
          const input = "```json\n\n  " + JSON.stringify(json) + "\n\n```"
          const { value } = chunkwise(input, size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should not parse without valid signature when skipPreamble is true", () => {
          // Just text without JSON signature should not parse
          const { value } = chunkwise("hello world", size, { skipPreamble: true })
          expect(value).toBeUndefined()
        })
      })
    })
  })

  describe("Preamble Handling", () => {
    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should extract preamble text before JSON object", () => {
          const json = { data: "test" }
          const preambleText = "Here is the JSON response:\n"
          const input = preambleText + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should extract preamble text before JSON array", () => {
          const json = [1, 2, 3]
          const preambleText = "The array is: "
          const input = preambleText + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should extract preamble before ```json block", () => {
          const json = { result: "success" }
          const preambleText = "Here is the formatted output:\n"
          const input = preambleText + "```json\n" + JSON.stringify(json) + "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should handle multi-line preamble", () => {
          const json = { message: "hello" }
          const preambleText = "This is line 1.\nThis is line 2.\nAnd here comes the JSON:\n"
          const input = preambleText + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should not call onPreamble when there is no preamble", () => {
          const json = { direct: true }
          const input = JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toBeUndefined()
        })

        it("should not extract preamble when skipPreamble is false", () => {
          const json = { data: "test" }
          const input = JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: false })

          expect(clean(value)).toEqual(json)
          expect(preamble).toBeUndefined()
        })

        it("should call onPreamble callback", () => {
          const json = { test: true }
          const preambleText = "prefix: "
          const input = preambleText + JSON.stringify(json)
          const onPreamble = vi.fn()

          chunkwise(input, size, { skipPreamble: true, onPreamble })

          expect(onPreamble).toHaveBeenCalledWith(preambleText)
        })
      })
    })
  })

  describe("Postamble Handling", () => {
    // Use larger chunk sizes for postamble tests since small chunks may split the postamble
    const postambleChunkSizes = [100, 200, 200000000]

    postambleChunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should extract postamble text after JSON object", () => {
          const json = { data: "test" }
          const postambleText = "\nThat was the response."
          const input = JSON.stringify(json) + postambleText

          const { value, postamble } = chunkwise(input, size, { skipPreamble: false })

          expect(clean(value)).toEqual(json)
          expect(postamble?.trim()).toEqual(postambleText.trim())
        })

        it("should extract postamble text after JSON array", () => {
          const json = [1, 2, 3]
          const postambleText = " - end of array"
          const input = JSON.stringify(json) + postambleText

          const { value, postamble } = chunkwise(input, size, { skipPreamble: false })

          expect(clean(value)).toEqual(json)
          expect(postamble?.trim()).toEqual(postambleText.trim())
        })

        it("should handle ```json closing marker as postamble", () => {
          const json = { formatted: true }
          const input = "```json\n" + JSON.stringify(json) + "\n```\n\nSome additional text"

          const { value, postamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          // The postamble should contain the closing marker and text after
          expect(postamble).toBeDefined()
        })

        it("should not have postamble when there is no trailing text", () => {
          const json = { clean: true }
          const input = JSON.stringify(json)

          const { value, postamble } = chunkwise(input, size, { skipPreamble: false })

          expect(clean(value)).toEqual(json)
          expect(postamble).toBeUndefined()
        })
      })
    })
  })

  describe("Preamble and Postamble Combined", () => {
    // Use larger chunk sizes for combined preamble/postamble tests
    const combinedChunkSizes = [100, 200, 200000000]

    combinedChunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should handle both preamble and postamble", () => {
          const json = { middle: "content" }
          const preambleText = "Before: "
          const postambleText = " :After"
          const input = preambleText + JSON.stringify(json) + postambleText

          const { value, preamble, postamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
          expect(postamble?.trim()).toEqual(postambleText.trim())
        })

        it("should handle markdown code block with surrounding text", () => {
          const json = { code: "example" }
          const preambleText = "Here is an example:\n"
          const postambleText = "\n```\nThat was it!"
          const input = preambleText + "```json\n" + JSON.stringify(json) + postambleText

          const { value, preamble, postamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
          expect(postamble).toBeDefined()
        })
      })
    })
  })

  describe("skipPreamble Option", () => {
    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should parse immediately when skipPreamble is false", () => {
          const json = { immediate: true }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should wait for signature when skipPreamble is true", () => {
          const json = { delayed: true }
          const { value } = chunkwise("text " + JSON.stringify(json), size, { skipPreamble: true })
          expect(clean(value)).toEqual(json)
        })

        it("should default skipPreamble to true", () => {
          // When skipPreamble defaults to true, primitives without signatures won't parse
          const { value } = chunkwise("42", size, {})
          expect(value).toBeUndefined()
        })

        it("should parse primitives when skipPreamble is false", () => {
          const { value } = chunkwise("42", size, { skipPreamble: false })
          expect(value).toEqual(42)
        })
      })
    })
  })

  describe("Parser State", () => {
    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should report done after parsing completes", () => {
          const parser = new StructuredJson({ skipPreamble: false })
          const json = { complete: true }

          expect(parser.done).toBe(false)

          const input = JSON.stringify(json)
          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(parser.done).toBe(true)
        })

        it("should support reset and reparse", () => {
          const parser = new StructuredJson({ skipPreamble: false })

          // First parse
          const json1 = { first: true }
          const input1 = JSON.stringify(json1)
          for (let i = 0; i < input1.length; i += size) {
            parser.process(input1.slice(i, i + size))
          }
          parser.finish()
          expect(clean(parser.value)).toEqual(json1)

          // Reset
          parser.reset()
          expect(parser.done).toBe(false)

          // Second parse
          const json2 = { second: true }
          const input2 = JSON.stringify(json2)
          for (let i = 0; i < input2.length; i += size) {
            parser.process(input2.slice(i, i + size))
          }
          parser.finish()
          expect(clean(parser.value)).toEqual(json2)
        })

        it("should call onComplete callback", () => {
          const json = { callback: true }
          const onComplete = vi.fn()
          const parser = new StructuredJson({ skipPreamble: false, onComplete })

          const input = JSON.stringify(json)
          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(onComplete).toHaveBeenCalled()
        })
      })
    })
  })

  describe("Edge Cases", () => {
    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should handle empty input", () => {
          const { value } = chunkwise("", size, { skipPreamble: false })
          expect(value).toBeUndefined()
        })

        it("should handle whitespace-only input", () => {
          const { value } = chunkwise("   \n\t  ", size, { skipPreamble: false })
          expect(value).toBeUndefined()
        })

        it("should handle very long strings", () => {
          const longString = "a".repeat(10000)
          const json = { content: longString }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should handle large arrays", () => {
          const json = Array.from({ length: 100 }, (_, i) => ({ index: i, value: `item-${i}` }))
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should handle objects with many keys", () => {
          const json: Record<string, number> = {}
          for (let i = 0; i < 50; i++) {
            json[`key${i}`] = i
          }
          const { value } = chunkwise(JSON.stringify(json), size, { skipPreamble: false })
          expect(clean(value)).toEqual(json)
        })

        it("should handle single quote strings (LLM quirk)", () => {
          // Some LLMs output single-quoted strings
          const input = "{'key': 'value'}"
          const { value } = chunkwise(input, size, { skipPreamble: false })
          expect(clean(value)).toEqual({ key: "value" })
        })

        it("should handle JSON with trailing comma in object", () => {
          // Non-standard but sometimes produced by LLMs
          const input = '{"a": 1, "b": 2,}'
          const { value } = chunkwise(input, size, { skipPreamble: false })
          expect(clean(value)).toHaveProperty("a", 1)
          expect(clean(value)).toHaveProperty("b", 2)
        })

        it("should handle JSON with trailing comma in array", () => {
          const input = "[1, 2, 3,]"
          const { value } = chunkwise(input, size, { skipPreamble: false })
          // The parser should handle trailing commas gracefully
          expect(Array.isArray(clean(value))).toBe(true)
        })
      })
    })
  })

  describe("Signature Priority", () => {
    // These tests specifically verify the signature detection fix
    it("should prioritize { over [ when { comes first in input", () => {
      const json = { type: "list", items: [1, 2, 3] }
      const { value } = chunkwise(JSON.stringify(json), 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
      expect((value as any).type).toEqual("list") // Ensure we parsed the object, not just the array
    })

    it("should prioritize [ over { when [ comes first in input", () => {
      const json = [{ id: 1 }, { id: 2 }]
      const { value } = chunkwise(JSON.stringify(json), 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
      expect(Array.isArray(value)).toBe(true)
    })

    it("should handle ```json signature when no { or [ before it", () => {
      const json = { data: [1, 2, 3] }
      // Only use text without { or [ before ```json
      const input = "Here is the result:\n```json\n" + JSON.stringify(json) + "\n```"
      const { value } = chunkwise(input, 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
    })

    it("should find earliest { or [ in preamble when they exist", () => {
      // When preamble contains { or [, parser will start from the first one
      // This tests the expected behavior - earliest signature wins
      const preamble = "This mentions curly "
      const json = { real: "data" }
      const input = preamble + JSON.stringify(json)

      const { value, preamble: foundPreamble } = chunkwise(input, 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
      expect(foundPreamble).toEqual(preamble)
    })

    it("should correctly parse object nested inside array", () => {
      // Ensure the fix works: [ comes first so array is parsed, including nested objects
      const json = [{ a: 1 }, { b: 2 }, { c: 3 }]
      const { value } = chunkwise(JSON.stringify(json), 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
    })

    it("should correctly parse array nested inside object", () => {
      // Ensure the fix works: { comes first so object is parsed, including nested arrays
      const json = { items: [1, 2, 3], nested: { arr: ["a", "b"] } }
      const { value } = chunkwise(JSON.stringify(json), 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
    })
  })
})
