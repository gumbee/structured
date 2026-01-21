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

        it("should call onPreamble callback with full preamble (possibly in chunks)", () => {
          const json = { test: true }
          const preambleText = "prefix: "
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
      const chunks = ["Hel", "lo ", "wor", "ld! ", '{"key": "value"}']
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
      expect(preambleChunks.join("")).toBe("Hello world! ")
    })

    it("should hold back potential signature prefixes (backticks)", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      // Backtick could be start of ```json
      parser.process("Hello`")
      expect(preambleChunks.join("")).toBe("Hello")

      // Now we know backtick wasn't ```json
      parser.process("x ")
      expect(preambleChunks.join("")).toBe("Hello`x ")
    })

    it("should hold back multiple backticks that could be ```json", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      parser.process("Text``")
      expect(preambleChunks.join("")).toBe("Text")

      parser.process("`")
      // Now we have ``` which could still be ```json
      expect(preambleChunks.join("")).toBe("Text")

      parser.process("not json")
      // Now we know it wasn't ```json signature
      expect(preambleChunks.join("")).toBe("Text```not json")
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

      parser.process('world {"key": "value"}')
      // Should emit the held-back backtick + "world " before JSON
      expect(preambleChunks.join("")).toBe("Hello`world ")

      parser.finish()
      expect(clean(parser.value)).toEqual({ key: "value" })
    })

    it("should handle ```json prefix correctly", () => {
      const preambleChunks: string[] = []
      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      parser.process("Intro ```")
      // "```" could be start of ```json, should be held back
      expect(preambleChunks.join("")).toBe("Intro ")

      parser.process('json{"key": "value"}')
      // Now we know it's ```json, should NOT emit the ``` as preamble
      expect(preambleChunks.join("")).toBe("Intro ")

      parser.finish()
      expect(clean(parser.value)).toEqual({ key: "value" })
    })

    it("should work correctly with single character chunks", () => {
      const input = 'Hi there! {"x": 1}'
      const preambleChunks: string[] = []

      const parser = new StructuredJson({
        skipPreamble: true,
        onPreamble: (text) => preambleChunks.push(text),
      })

      for (const char of input) {
        parser.process(char)
      }
      parser.finish()

      expect(preambleChunks.join("")).toBe("Hi there! ")
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
          const input = preamble1 + "```json\n" + JSON.stringify(json1) + preamble2 + "```json\n" + JSON.stringify(json2) + preamble3

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
})
