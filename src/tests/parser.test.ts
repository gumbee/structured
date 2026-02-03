import { describe, it, expect, vi } from "vitest"
import { StructuredJson, type StructuredJsonOptions, clean } from "@/index"

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
      // Accumulate preamble chunks (progressive emission)
      preamble = (preamble ?? "") + text
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

        it("should detect code block signature and parse content", () => {
          const json = { code: "block" }
          const input = "```structured\n" + JSON.stringify(json) + "\n```"
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

        it("should handle code block signature with extra whitespace", () => {
          const json = { test: true }
          const input = "```structured\n\n  " + JSON.stringify(json) + "\n\n```"
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
          const preambleText = "The array is:\n"
          const input = preambleText + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should extract preamble before code block signature", () => {
          const json = { result: "success" }
          const preambleText = "Here is the formatted output:\n"
          const input = preambleText + "```structured\n" + JSON.stringify(json) + "\n```"

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

        it("should call onPreamble callback with full preamble (possibly in chunks)", () => {
          const json = { test: true }
          const preambleText = "prefix:\n"
          const input = preambleText + JSON.stringify(json)
          const preambleChunks: string[] = []

          chunkwise(input, size, {
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          // All chunks together should form the full preamble
          expect(preambleChunks.join("")).toBe(preambleText)
        })
      })
    })
  })

  describe("Progressive Preamble Emission", () => {
    it("should emit preamble progressively in chunks as they arrive", () => {
      const chunks = ["Hel", "lo ", "wor", "ld!\n", '{"key": "value"}']
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (const chunk of chunks) {
        parser.process(chunk)
      }
      parser.finish()

      // Should have received multiple preamble chunks, not just one
      expect(preambleChunks.length).toBeGreaterThan(1)
      // All chunks together should form the full preamble
      expect(preambleChunks.join("")).toBe("Hello world!\n")
    })

    it("should hold back potential signature prefixes (backticks)", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      // Backtick could be start of ```structured
      parser.process("Hello`")
      expect(preambleChunks.join("")).toBe("Hello")

      // Now we know backtick wasn't ```structured
      parser.process("x ")
      expect(preambleChunks.join("")).toBe("Hello`x ")
    })

    it("should hold back multiple backticks that could be code block signature", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      parser.process("Text``")
      expect(preambleChunks.join("")).toBe("Text")

      parser.process("`")
      // Now we have ``` which could still be ```structured
      expect(preambleChunks.join("")).toBe("Text")

      parser.process("not structured")
      // Now we know it wasn't ```structured signature
      expect(preambleChunks.join("")).toBe("Text```not structured")
    })

    it("should emit held-back text on finish() when no JSON found", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      parser.process("Hello`")
      expect(preambleChunks.join("")).toBe("Hello")

      parser.finish()
      // On finish, held-back backtick should be emitted
      expect(preambleChunks.join("")).toBe("Hello`")
    })

    it("should emit remaining preamble when JSON signature is found", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      parser.process("Hello`")
      expect(preambleChunks.join("")).toBe("Hello")

      parser.process('world\n{"key": "value"}')
      // Should emit the held-back backtick + "world\n" before JSON
      expect(preambleChunks.join("")).toBe("Hello`world\n")

      parser.finish()
      expect(clean(parser.value)).toEqual({ key: "value" })
    })

    it("should handle code block prefix correctly", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      parser.process("Intro ```")
      // "```" could be start of ```structured, should be held back
      expect(preambleChunks.join("")).toBe("Intro ")

      parser.process('structured{"key": "value"}')
      // Now we know it's ```structured, should NOT emit the ``` as preamble
      expect(preambleChunks.join("")).toBe("Intro ")

      parser.finish()
      expect(clean(parser.value)).toEqual({ key: "value" })
    })

    it("should work correctly with single character chunks", () => {
      const input = 'Hi there!\n{"x": 1}'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (const char of input) {
        parser.process(char)
      }
      parser.finish()

      expect(preambleChunks.join("")).toBe("Hi there!\n")
      expect(clean(parser.value)).toEqual({ x: 1 })
    })

    it("should emit preamble progressively in multiple mode with multiple JSON values", () => {
      const json1 = { first: 1 }
      const json2 = { second: 2 }
      const preamble1 = "Here is the first JSON:\n"
      const preamble2 = "\n\nAnd here is the second:\n"
      const input = preamble1 + JSON.stringify(json1) + preamble2 + JSON.stringify(json2)

      const preambleChunks: string[] = []
      const completedValues: unknown[] = []
      const preambleSegments: string[] = []
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
          // Save the accumulated preamble for this segment
          if (currentSegment) {
            preambleSegments.push(currentSegment)
            currentSegment = ""
          }
        },
      })

      // Process in small chunks to verify progressive emission
      for (let i = 0; i < input.length; i += 3) {
        parser.process(input.slice(i, i + 3))
      }
      parser.finish()

      // Should have received multiple preamble chunks (progressive emission)
      expect(preambleChunks.length).toBeGreaterThan(2)

      // Two JSON values should have been parsed
      expect(completedValues.length).toBe(2)
      expect(clean(completedValues[0])).toEqual(json1)
      expect(clean(completedValues[1])).toEqual(json2)

      // Preamble segments should match the expected text
      expect(preambleSegments.length).toBe(2)
      expect(preambleSegments[0]).toBe(preamble1)
      expect(preambleSegments[1]).toBe(preamble2)
    })

    it("should progressively emit trailing text in multiple mode when no more JSON", () => {
      const json = { only: 1 }
      const trailingText = "\n\nThat's all folks! No more JSON here."
      const input = JSON.stringify(json) + trailingText

      const preambleChunks: string[] = []
      const completedValues: unknown[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        multiple: true,
        onPreamble: (text) => preambleChunks.push(text),
        onComplete: (json) => completedValues.push(json),
      })

      // Process character by character
      for (const char of input) {
        parser.process(char)
      }
      parser.finish()

      // One JSON value should have been parsed
      expect(completedValues.length).toBe(1)
      expect(clean(completedValues[0])).toEqual(json)

      // Trailing text should be emitted progressively as preamble chunks
      expect(preambleChunks.length).toBeGreaterThan(1)
      expect(preambleChunks.join("")).toBe(trailingText)
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

        it("should handle code block closing marker as postamble", () => {
          const json = { formatted: true }
          const input = "```structured\n" + JSON.stringify(json) + "\n```\n\nSome additional text"

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
          const preambleText = "Before:\n"
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
          const input = preambleText + "```structured\n" + JSON.stringify(json) + postambleText

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
          const { value } = chunkwise("text\n" + JSON.stringify(json), size, { skipPreamble: true })
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

    it("should handle code block signature when no { or [ before it", () => {
      const json = { data: [1, 2, 3] }
      // Only use text without { or [ before code block signature
      const input = "Here is the result:\n```structured\n" + JSON.stringify(json) + "\n```"
      const { value } = chunkwise(input, 1, { skipPreamble: true })
      expect(clean(value)).toEqual(json)
    })

    it("should find earliest { or [ at line start in preamble when they exist", () => {
      // When preamble contains { or [ at line start, parser will start from the first valid one
      // This tests the expected behavior - earliest valid signature wins
      const preamble = "This mentions curly\n"
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

  describe("Multiple JSON Parsing", () => {
    /**
     * Helper to parse multiple JSON values with the `multiple` option
     * Accumulates preamble chunks per segment (between JSON values)
     */
    const parseMultiple = <T = any>(
      text: string,
      chunkSize: number,
      options: StructuredJsonOptions<T> = {},
    ): { values: T[]; preambles: string[] } => {
      const values: T[] = []
      const preambles: string[] = []
      let currentPreamble = ""

      const parser = new StructuredJson<T>({
        ...options,
        multiple: true,
        onPreamble: (text) => {
          // Accumulate preamble chunks (progressive emission)
          currentPreamble += text
          options.onPreamble?.(text)
        },
        onComplete: (json, remainder) => {
          // When a JSON is complete, save the accumulated preamble for this segment
          if (currentPreamble.trim()) {
            preambles.push(currentPreamble)
          }
          currentPreamble = ""
          values.push(json)
          options.onComplete?.(json, remainder)
        },
      })

      for (let i = 0; i < text.length; i += chunkSize) {
        parser.process(text.slice(i, i + chunkSize))
      }

      parser.finish()

      // After finish, any remaining preamble (trailing text with no JSON) is captured
      if (currentPreamble.trim()) {
        preambles.push(currentPreamble)
      }

      return { values, preambles }
    }

    const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should parse two JSON objects separated by text", () => {
          const json1 = { first: true }
          const json2 = { second: true }
          const betweenText = "\n\nHere's another:\n"
          const input = JSON.stringify(json1) + betweenText + JSON.stringify(json2)

          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(2)
          expect(clean(values[0])).toEqual(json1)
          expect(clean(values[1])).toEqual(json2)
          // Text between JSONs is emitted as preamble before the second JSON
          expect(preambles.length).toBe(1)
          expect(preambles[0]).toBe(betweenText)
        })

        it("should parse two JSON objects in code fence blocks", () => {
          const json1 = { code: "first" }
          const json2 = { code: "second" }
          const preamble1 = "First block:\n"
          const preamble2 = "\n```\n\nSecond block:\n" // closing ``` + text before next fence
          const preamble3 = "\n```" // trailing closing fence
          const input = preamble1 + "```structured\n" + JSON.stringify(json1) + preamble2 + "```structured\n" + JSON.stringify(json2) + preamble3

          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(2)
          expect(clean(values[0])).toEqual(json1)
          expect(clean(values[1])).toEqual(json2)
          // Preambles: before first JSON, between JSONs (incl closing fence), trailing (incl closing fence)
          expect(preambles.length).toBe(3)
          expect(preambles[0]).toBe(preamble1)
          expect(preambles[1]).toBe(preamble2)
          expect(preambles[2]).toBe(preamble3)
        })

        it("should parse array followed by object", () => {
          const arr = [1, 2, 3]
          const obj = { after: "array" }
          // Whitespace-only text between JSONs is not emitted as preamble
          const input = JSON.stringify(arr) + "\n" + JSON.stringify(obj)

          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(2)
          expect(clean(values[0])).toEqual(arr)
          expect(clean(values[1])).toEqual(obj)
          // Whitespace-only content is not emitted as preamble (trimmed to empty)
          expect(preambles.length).toBe(0)
        })

        it("should parse multiple back-to-back objects", () => {
          const json1 = { a: 1 }
          const json2 = { b: 2 }
          const json3 = { c: 3 }
          // Objects end with }, so next { is valid signature - no separator text
          const input = JSON.stringify(json1) + JSON.stringify(json2) + JSON.stringify(json3)

          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(3)
          expect(clean(values[0])).toEqual(json1)
          expect(clean(values[1])).toEqual(json2)
          expect(clean(values[2])).toEqual(json3)
          // No preambles since objects are directly adjacent
          expect(preambles.length).toBe(0)
        })

        it("should work with single JSON when multiple is true", () => {
          const json = { single: true }
          const input = JSON.stringify(json)

          const { values } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(1)
          expect(clean(values[0])).toEqual(json)
        })

        it("should handle preamble before first JSON only", () => {
          const json = { only: true }
          const input = "Here is the JSON:\n" + JSON.stringify(json)

          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(1)
          expect(clean(values[0])).toEqual(json)
          expect(preambles.length).toBe(1)
          expect(preambles[0]).toBe("Here is the JSON:\n")
        })

        it("should call onComplete for each JSON value", () => {
          const json1 = { first: 1 }
          const json2 = { second: 2 }
          // Use back-to-back objects to avoid preamble complexity
          const input = JSON.stringify(json1) + JSON.stringify(json2)
          const onComplete = vi.fn()

          parseMultiple(input, size, { skipPreamble: true, onComplete })

          expect(onComplete).toHaveBeenCalledTimes(2)
        })

        it("should handle no JSON in input with multiple enabled", () => {
          const input = "Just some text without JSON"
          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(0)
          expect(preambles.length).toBe(1)
          expect(preambles[0]).toBe(input)
        })

        it("should parse JSON with trailing text that has no more JSON", () => {
          const json = { message: "hello" }
          const trailingText = "\n\nThat's all folks!"
          const input = JSON.stringify(json) + trailingText

          const { values, preambles } = parseMultiple(input, size, { skipPreamble: true })

          expect(values.length).toBe(1)
          expect(clean(values[0])).toEqual(json)
          // The trailing text should be emitted as preamble when finish() is called
          expect(preambles.length).toBe(1)
          expect(preambles[0]).toBe(trailingText)
        })
      })
    })
  })

  describe("Widgets Signature (with signatureIdentifier: 'widgets')", () => {
    const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should detect ```widgets signature and parse content", () => {
          const json = { widget: "test" }
          const input = "```widgets\n" + JSON.stringify(json) + "\n```"
          const { value } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })
          expect(clean(value)).toEqual(json)
        })

        it("should handle ```widgets with extra whitespace", () => {
          const json = { spaced: true }
          const input = "```widgets\n\n  " + JSON.stringify(json) + "\n\n```"
          const { value } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })
          expect(clean(value)).toEqual(json)
        })

        it("should extract preamble before ```widgets block", () => {
          const json = { result: "success" }
          const preambleText = "Here is the widget output:\n"
          const input = preambleText + "```widgets\n" + JSON.stringify(json) + "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should hold back ```widget prefix that could become ```widgets", () => {
          const preambleChunks: string[] = []
          const parser = new StructuredJson({
            skipPreamble: true,
            signatureIdentifier: "widgets",
            onPreamble: (text) => preambleChunks.push(text),
          })

          parser.process("Intro ```widget")
          // "```widget" could be start of ```widgets, should be held back
          expect(preambleChunks.join("")).toBe("Intro ")

          parser.process('s{"key": "value"}')
          // Now we know it's ```widgets, should NOT emit the prefix as preamble
          expect(preambleChunks.join("")).toBe("Intro ")

          parser.finish()
          expect(clean(parser.value)).toEqual({ key: "value" })
        })
      })
    })
  })

  describe("Code Fence Skipping (with signatureIdentifier: 'widgets')", () => {
    const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should skip ```json blocks and NOT parse them", () => {
          // ```json should now be skipped entirely and emitted as preamble
          const input = '```json\n{"example": true}\n```'
          const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })

          // Should NOT parse the JSON inside ```json block
          expect(value).toBeUndefined()
          // The entire content should be emitted as preamble
          expect(preamble).toBe(input)
        })

        it("should skip ```json block and continue to find ```widgets", () => {
          const exampleJson = { example: true }
          const actualJson = { result: "success" }
          const input =
            "Here's an example:\n```json\n" +
            JSON.stringify(exampleJson) +
            "\n```\n\nNow the actual output:\n```widgets\n" +
            JSON.stringify(actualJson) +
            "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })

          expect(clean(value)).toEqual(actualJson)
          // Preamble should include everything before ```widgets
          expect(preamble).toContain("Here's an example:")
          expect(preamble).toContain("```json")
          expect(preamble).toContain(JSON.stringify(exampleJson))
        })

        it("should skip ```typescript blocks", () => {
          const actualJson = { parsed: true }
          const input = '```typescript\nconst obj = { name: "test" };\n```\n\n```widgets\n' + JSON.stringify(actualJson) + "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })

          expect(clean(value)).toEqual(actualJson)
          expect(preamble).toContain("```typescript")
          expect(preamble).toContain("const obj")
        })

        it("should skip ```javascript blocks", () => {
          const actualJson = { parsed: true }
          const input = "```javascript\nfunction test() { return [1,2,3]; }\n```\n\n```widgets\n" + JSON.stringify(actualJson) + "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })

          expect(clean(value)).toEqual(actualJson)
          expect(preamble).toContain("```javascript")
        })

        it("should skip multiple code fences before ```widgets", () => {
          const actualJson = { final: "result" }
          const input =
            'Example 1:\n```json\n{"a": 1}\n```\n\n' +
            "Example 2:\n```typescript\nconst x = 5;\n```\n\n" +
            "Example 3:\n```python\nprint('hello')\n```\n\n" +
            "Actual output:\n```widgets\n" +
            JSON.stringify(actualJson) +
            "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: "widgets" })

          expect(clean(value)).toEqual(actualJson)
          expect(preamble).toContain("```json")
          expect(preamble).toContain("```typescript")
          expect(preamble).toContain("```python")
        })

        it("should emit code fence content as preamble", () => {
          const preambleChunks: string[] = []
          const actualJson = { test: true }
          const codeContent = "const x = { inline: true };"
          const input = "```javascript\n" + codeContent + "\n```\n\n```widgets\n" + JSON.stringify(actualJson) + "\n```"

          const parser = new StructuredJson({
            skipPreamble: true,
            signatureIdentifier: "widgets",
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          const fullPreamble = preambleChunks.join("")
          expect(fullPreamble).toContain(codeContent)
          expect(clean(parser.value)).toEqual(actualJson)
        })
      })
    })
  })

  describe("Newline Requirement for { and [", () => {
    const chunkSizes = [1, 2, 3, 4, 10, 20, 100, 200, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should detect { at start of input", () => {
          const json = { direct: true }
          const input = JSON.stringify(json)

          const { value } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
        })

        it("should detect { after newline", () => {
          const json = { afterNewline: true }
          const preambleText = "Here is the result:\n"
          const input = preambleText + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should NOT detect { mid-line", () => {
          // { appearing in the middle of a line should be treated as preamble text
          const input = "Use objects {like this} for configuration."

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          // Should NOT parse the inline {like this}
          expect(value).toBeUndefined()
          // The entire text should be preamble
          expect(preamble).toBe(input)
        })

        it("should NOT detect [ mid-line", () => {
          // [ appearing in the middle of a line should be treated as preamble text
          const input = "Arrays [1, 2, 3] are useful for lists."

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          // Should NOT parse the inline [1, 2, 3]
          expect(value).toBeUndefined()
          // The entire text should be preamble
          expect(preamble).toBe(input)
        })

        it("should detect [ at start of input", () => {
          const json = [1, 2, 3]
          const input = JSON.stringify(json)

          const { value } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
        })

        it("should detect [ after newline", () => {
          const json = ["a", "b", "c"]
          const preambleText = "The array:\n"
          const input = preambleText + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toEqual(preambleText)
        })

        it("should handle multiple { mid-line and find the one after newline", () => {
          const json = { correct: true }
          const input = "Inline {braces} are ignored.\n" + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toBe("Inline {braces} are ignored.\n")
        })

        it("should handle multiple [ mid-line and find the one after newline", () => {
          const json = [1, 2, 3]
          const input = "Inline [brackets] are ignored.\n" + JSON.stringify(json)

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toBe("Inline [brackets] are ignored.\n")
        })

        it("should still detect code block signature regardless of line position", () => {
          // code block signature doesn't need newline requirement since it's unambiguous
          const json = { widget: true }
          const input = "Output: ```structured\n" + JSON.stringify(json) + "\n```"

          const { value, preamble } = chunkwise(input, size, { skipPreamble: true })

          expect(clean(value)).toEqual(json)
          expect(preamble).toBe("Output: ")
        })
      })
    })
  })

  describe("Custom Signature Identifier", () => {
    const identifiers = ["structured", "widgets", "json-output", "data", "result", "ai"]
    const chunkSizes = [1, 2, 10, 100, 200000000]

    identifiers.forEach((identifier) => {
      describe(`identifier "${identifier}"`, () => {
        chunkSizes.forEach((size) => {
          describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
            it("should detect custom signature and parse content", () => {
              const json = { test: "value", identifier }
              const input = "```" + identifier + "\n" + JSON.stringify(json) + "\n```"
              const { value } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: identifier })
              expect(clean(value)).toEqual(json)
            })

            it("should extract preamble before custom signature", () => {
              const json = { data: 123 }
              const preambleText = "Here is the output:\n"
              const input = preambleText + "```" + identifier + "\n" + JSON.stringify(json) + "\n```"

              const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: identifier })

              expect(clean(value)).toEqual(json)
              expect(preamble).toEqual(preambleText)
            })

            it("should skip other code fences and find custom signature", () => {
              const exampleJson = { example: true }
              const actualJson = { result: "success" }
              const input =
                "Example:\n```json\n" +
                JSON.stringify(exampleJson) +
                "\n```\n\nOutput:\n```" +
                identifier +
                "\n" +
                JSON.stringify(actualJson) +
                "\n```"

              const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: identifier })

              expect(clean(value)).toEqual(actualJson)
              expect(preamble).toContain("```json")
              expect(preamble).toContain(JSON.stringify(exampleJson))
            })

            it("should handle custom signature with extra whitespace", () => {
              const json = { spaced: true }
              const input = "```" + identifier + "\n\n  " + JSON.stringify(json) + "\n\n```"
              const { value } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: identifier })
              expect(clean(value)).toEqual(json)
            })

            it("should not detect other identifiers as target signature", () => {
              // Use a different identifier than what we're looking for
              const otherIdentifier = identifier === "structured" ? "widgets" : "structured"
              const json = { wrong: "identifier" }
              const input = "```" + otherIdentifier + "\n" + JSON.stringify(json) + "\n```"

              const { value, preamble } = chunkwise(input, size, { skipPreamble: true, signatureIdentifier: identifier })

              // Should NOT parse the JSON since it's not our target signature
              expect(value).toBeUndefined()
              // The entire content should be preamble
              expect(preamble).toBe(input)
            })
          })
        })

        it("should hold back partial prefix that could become the target signature", () => {
          const preambleChunks: string[] = []
          const parser = new StructuredJson({
            skipPreamble: true,
            signatureIdentifier: identifier,
            onPreamble: (text) => preambleChunks.push(text),
          })

          // Build a partial prefix: "```" + first few chars of identifier
          const partialPrefix = "```" + identifier.slice(0, Math.min(2, identifier.length))
          parser.process("Intro " + partialPrefix)
          // Partial prefix should be held back
          expect(preambleChunks.join("")).toBe("Intro ")

          // Complete the signature and add JSON
          const remaining = identifier.slice(Math.min(2, identifier.length))
          parser.process(remaining + '{"key": "value"}')
          // Still should not emit the prefix as preamble since it became our signature
          expect(preambleChunks.join("")).toBe("Intro ")

          parser.finish()
          expect(clean(parser.value)).toEqual({ key: "value" })
        })

        it("should emit held-back prefix when it does not match signature", () => {
          const preambleChunks: string[] = []
          const parser = new StructuredJson({
            skipPreamble: true,
            signatureIdentifier: identifier,
            onPreamble: (text) => preambleChunks.push(text),
          })

          parser.process("Text ```")
          // "```" is held back as potential signature prefix
          expect(preambleChunks.join("")).toBe("Text ")

          // Add something that doesn't match our identifier
          parser.process("notmatching\nsome text")
          // Now the held-back "```" should be emitted since it's not our signature
          expect(preambleChunks.join("")).toContain("```notmatching")

          parser.finish()
        })
      })
    })

    it("should default to 'structured' when no signatureIdentifier is provided", () => {
      const json = { default: true }
      const input = "```structured\n" + JSON.stringify(json) + "\n```"

      const { value } = chunkwise(input, 100, { skipPreamble: true })

      expect(clean(value)).toEqual(json)
    })

    it("should NOT match ```widgets when default 'structured' is used", () => {
      const json = { wrong: true }
      const input = "```widgets\n" + JSON.stringify(json) + "\n```"

      const { value, preamble } = chunkwise(input, 100, { skipPreamble: true })

      // Default is "structured", so ```widgets should not be matched
      expect(value).toBeUndefined()
      expect(preamble).toBe(input)
    })
  })

  describe("Code Fence Skipping Without onPreamble Callback", () => {
    /**
     * These tests verify that code fence skipping works correctly even when
     * no onPreamble callback is provided. This is a regression test for a bug
     * where infinite recursion occurred because #emittedPreambleLength was
     * only updated when onPreamble was set.
     */
    const chunkSizes = [1, 2, 10, 100, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should skip non-target code fences without onPreamble callback (no infinite recursion)", () => {
          // This input has a ```json code fence that should be skipped
          // Bug: Without the fix, this causes "Maximum call stack size exceeded"
          const json = { result: "success" }
          const input =
            "Example:\n```json\n" +
            JSON.stringify({ example: true }) +
            "\n```\n\nOutput:\n```structured\n" +
            JSON.stringify(json) +
            "\n```"

          // No onPreamble callback - this is what triggers the bug
          const parser = new StructuredJson({
            skipPreamble: true,
            // Deliberately NOT providing onPreamble
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should handle multiple mode with code fence skipping (no hang)", () => {
          // Test multiple mode with code fence that needs to be skipped
          // Simulates the create_plan scenario where LLM outputs text with code fences
          const json1 = [{ type: "section", title: "First" }]
          const json2 = [{ type: "section", title: "Second" }]
          const input =
            "Here is an example:\n```json\n" +
            JSON.stringify({ example: true }) +
            "\n```\n\nNow the actual output:\n```structured\n" +
            JSON.stringify(json1) +
            "\n```\n\nMore text\n```structured\n" +
            JSON.stringify(json2) +
            "\n```"

          const completedValues: unknown[] = []
          const parser = new StructuredJson({
            skipPreamble: true,
            multiple: true,
            onComplete: (json) => completedValues.push(json),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(completedValues.length).toBe(2)
          expect(clean(completedValues[0])).toEqual(json1)
          expect(clean(completedValues[1])).toEqual(json2)
        })

        it("should handle multiple code fences without onPreamble callback", () => {
          const json = { final: "value" }
          const input =
            '```json\n{"a": 1}\n```\n' +
            '```typescript\nconst x = 1;\n```\n' +
            '```python\nprint("hi")\n```\n' +
            "```structured\n" +
            JSON.stringify(json) +
            "\n```"

          const parser = new StructuredJson({
            skipPreamble: true,
            // No onPreamble callback
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should skip code fences when no target signature exists without onPreamble callback", () => {
          // Only has non-target code fence, no structured block
          const input = '```json\n{"example": true}\n```\nSome text after'

          const parser = new StructuredJson({
            skipPreamble: true,
            // No onPreamble callback
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          // No target signature found, so value should be undefined
          expect(parser.value).toBeUndefined()
        })

        it("should handle incomplete code fence without onPreamble callback", () => {
          // Code fence that never closes
          const input = '```json\n{"incomplete": true}'

          const parser = new StructuredJson({
            skipPreamble: true,
            // No onPreamble callback
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          // No target signature found
          expect(parser.value).toBeUndefined()
        })

        it("should handle onComplete without onPreamble when skipping code fences", () => {
          const json = { completed: true }
          const input = '```json\n{"skip": true}\n```\n```structured\n' + JSON.stringify(json) + "\n```"
          const completedValues: unknown[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            // No onPreamble, but has onComplete
            onComplete: (value) => completedValues.push(value),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(completedValues.length).toBe(1)
          expect(clean(completedValues[0])).toEqual(json)
        })

        it("should reset insideCodeFence state in multiple mode", () => {
          // Test that #insideCodeFence is properly reset when multiple mode resets
          // This is important when the first JSON ends while still conceptually
          // "inside" a preamble code fence, and we need to parse more JSON
          const json1 = { first: 1 }
          const json2 = { second: 2 }
          const preambleChunks: string[] = []
          const completedValues: unknown[] = []

          // First segment has a code fence that closes, then JSON
          // Second segment should parse correctly without leftover state
          const input =
            "Example:\n```typescript\nconst x = 1;\n```\n```structured\n" +
            JSON.stringify(json1) +
            "\n```\n\nMore code:\n```javascript\nconst y = 2;\n```\n```structured\n" +
            JSON.stringify(json2) +
            "\n```"

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

          expect(completedValues.length).toBe(2)
          expect(clean(completedValues[0])).toEqual(json1)
          expect(clean(completedValues[1])).toEqual(json2)
        })
      })
    })
  })

  describe("Multiple Mode Edge Cases", () => {
    /**
     * Tests for edge cases in multiple mode parsing that could cause hangs
     * or incorrect behavior.
     */
    const chunkSizes = [1, 2, 10, 100, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should handle multiple JSON values with interleaved non-target code fences", () => {
          const values = [{ a: 1 }, { b: 2 }, { c: 3 }]
          const completedValues: unknown[] = []

          const input =
            "```json\n{\"skip\": 1}\n```\n" +
            "```structured\n" +
            JSON.stringify(values[0]) +
            "\n```\n" +
            "```python\nprint('skip')\n```\n" +
            "```structured\n" +
            JSON.stringify(values[1]) +
            "\n```\n" +
            "```typescript\nconst skip = true;\n```\n" +
            "```structured\n" +
            JSON.stringify(values[2]) +
            "\n```"

          const parser = new StructuredJson({
            skipPreamble: true,
            multiple: true,
            onComplete: (json) => completedValues.push(json),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(completedValues.length).toBe(3)
          expect(clean(completedValues[0])).toEqual(values[0])
          expect(clean(completedValues[1])).toEqual(values[1])
          expect(clean(completedValues[2])).toEqual(values[2])
        })

        it("should handle LLM-style output with widgets (simulates create_plan)", () => {
          // This simulates what create_plan might receive from an LLM
          const widgets = [
            { type: "section", title: "Overview" },
            { type: "text", text: "Some content" },
          ]
          const completedValues: unknown[] = []
          const preambleChunks: string[] = []

          const input =
            "I'll create a plan for you.\n\n" +
            "Here's the structure:\n\n" +
            "```structured\n" +
            JSON.stringify(widgets) +
            "\n```\n\n" +
            "That's the plan!"

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
          expect(clean(completedValues[0])).toEqual(widgets)
          expect(preambleChunks.join("")).toContain("I'll create a plan for you")
        })

        it("should not hang when processing empty code blocks", () => {
          const json = { test: true }
          const completedValues: unknown[] = []

          // Edge case: empty code blocks
          const input =
            "```json\n\n```\n" +
            "```structured\n" +
            JSON.stringify(json) +
            "\n```"

          const parser = new StructuredJson({
            skipPreamble: true,
            multiple: true,
            onComplete: (json) => completedValues.push(json),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(completedValues.length).toBe(1)
          expect(clean(completedValues[0])).toEqual(json)
        })

        it("should handle consecutive code blocks without text between them", () => {
          const json = { consecutive: true }
          const completedValues: unknown[] = []

          // Code blocks right after each other
          const input =
            "```json\n{}\n```" +
            "```structured\n" +
            JSON.stringify(json) +
            "\n```"

          const parser = new StructuredJson({
            skipPreamble: true,
            multiple: true,
            onComplete: (json) => completedValues.push(json),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(completedValues.length).toBe(1)
          expect(clean(completedValues[0])).toEqual(json)
        })
      })
    })
  })

  describe("JSON Not At Line Start Scenarios", () => {
    /**
     * Tests for when JSON appears inline (not at line start).
     * The parser should still parse JSON via finish() if it's the only complete JSON in input.
     * This simulates LLM output like: "Here are the widgets: ["a", "b"]"
     */
    const chunkSizes = [1, 2, 10, 100, 200000000]

    chunkSizes.forEach((size) => {
      describe(`chunk size ${size > 2000 ? "full" : size}`, () => {
        it("should parse JSON at line start after preamble text", () => {
          const json = ["section", "text"]
          const input = "Here are the widgets:\n" + JSON.stringify(json)

          const parser = new StructuredJson({
            skipPreamble: true,
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should handle JSON on same line as preamble (not at line start)", () => {
          // When JSON is NOT at line start, parser treats it as preamble
          // This is by design - but we need to handle it gracefully
          const json = ["section", "text"]
          const input = "Here are the widgets: " + JSON.stringify(json)
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          // The JSON is not at line start, so it's treated as preamble
          // Parser should NOT hang - it should emit everything as preamble
          expect(parser.value).toBeUndefined()
          expect(preambleChunks.join("")).toBe(input)
        })

        it("should parse object at line start", () => {
          const json = { key: "value" }
          const input = "Output:\n" + JSON.stringify(json)

          const parser = new StructuredJson({
            skipPreamble: true,
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should parse array at very start of input (no preamble)", () => {
          const json = ["a", "b", "c"]
          const input = JSON.stringify(json)

          const parser = new StructuredJson({
            skipPreamble: true,
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should parse object at very start of input (no preamble)", () => {
          const json = { first: true }
          const input = JSON.stringify(json)

          const parser = new StructuredJson({
            skipPreamble: true,
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should emit all content as preamble when no valid signature found", () => {
          // This simulates LLM output that doesn't follow the expected format
          const input = "I'll help with that. Here are some options: [option1, option2]"
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          // No valid JSON signature at line start, so everything is preamble
          expect(parser.value).toBeUndefined()
          expect(preambleChunks.join("")).toBe(input)
        })

        it("should detect { with leading spaces on a new line", () => {
          const json = { indented: true }
          const input = "Output:\n  " + JSON.stringify(json)
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
          expect(preambleChunks.join("")).toBe("Output:\n  ")
        })

        it("should detect [ with leading spaces on a new line", () => {
          const json = ["a", "b", "c"]
          const input = "Array:\n    " + JSON.stringify(json)
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
          expect(preambleChunks.join("")).toBe("Array:\n    ")
        })

        it("should detect { with leading tabs on a new line", () => {
          const json = { tabbed: true }
          const input = "Result:\n\t\t" + JSON.stringify(json)
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
          expect(preambleChunks.join("")).toBe("Result:\n\t\t")
        })

        it("should detect { with mixed spaces and tabs on a new line", () => {
          const json = { mixed: true }
          const input = "Data:\n \t " + JSON.stringify(json)
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
          expect(preambleChunks.join("")).toBe("Data:\n \t ")
        })

        it("should detect { with leading whitespace at start of input", () => {
          const json = { start: true }
          const input = "  " + JSON.stringify(json)

          const parser = new StructuredJson({
            skipPreamble: true,
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(clean(parser.value)).toEqual(json)
        })

        it("should NOT detect { with leading non-whitespace characters", () => {
          // "x{" should not be detected because 'x' is not whitespace
          const input = "x{\"key\": \"value\"}"
          const preambleChunks: string[] = []

          const parser = new StructuredJson({
            skipPreamble: true,
            onPreamble: (text) => preambleChunks.push(text),
          })

          for (let i = 0; i < input.length; i += size) {
            parser.process(input.slice(i, i + size))
          }
          parser.finish()

          expect(parser.value).toBeUndefined()
          expect(preambleChunks.join("")).toBe(input)
        })
      })
    })
  })
})
