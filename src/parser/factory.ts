import * as z from "zod"
import { type ProgressiveValue } from "./progressive-value"
import { ProgressiveNumber } from "./progressive-number"
import { ProgressiveBoolean } from "./progressive-boolean"
import { ProgressiveNull } from "./progressive-null"
import { ProgressiveUndefined } from "./progressive-undefined"
import { ProgressiveString } from "./progressive-string"
import { StructuredObject } from "./structured-object"
import { StructuredArray } from "./structured-array"
import { type StructuredParseOptions } from "./types"

/**
 * Trims irrelevant characters from the start of the chunk so that the next character is semantically relevant for the JSON
 */
const trimIrrelevantCharacters = (chunk: string): string => {
  chunk = chunk.trimStart()

  if (chunk.startsWith(",")) {
    chunk = chunk.slice(1).trimStart()
  }

  return chunk
}

/**
 * Creates a schema-aware progressive JSON parser based on the input and schema
 *
 * @param chunk - The input string to parse
 * @param schema - Optional schema to guide parsing
 * @param onComplete - Callback when parsing completes
 * @param registry - Optional registry for dynamic schema resolution
 * @returns Tuple of [parser, remaining string] or [null, chunk] if can't start parsing
 */
export function makeStructuredParser(chunk: string, options: StructuredParseOptions): [ProgressiveValue | null, string] {
  let stream: ProgressiveValue
  let skip: string = ""

  chunk = trimIrrelevantCharacters(chunk)
  // get the first character that's relevant for the JSON
  const char = chunk[0]
  const type = getActualType(char)

  // Create parser based on input type
  if (type === "number") {
    stream = new ProgressiveNumber(options)
  } else if (type === "string") {
    skip = chunk[0]
    stream = new ProgressiveString(chunk[0], options)
  } else if (type === "array") {
    stream = new StructuredArray(options)
    skip = "["
  } else if (type === "object") {
    stream = new StructuredObject(options)
    skip = "{"
  } else if (type === "null") {
    stream = new ProgressiveNull(options)
  } else if (type === "undefined") {
    // Handle 'undefined' - LLMs sometimes output this instead of null
    stream = new ProgressiveUndefined(options)
  } else if (type === "boolean") {
    stream = new ProgressiveBoolean(options)
  } else {
    return [null, chunk]
  }

  return [stream, chunk.slice(skip.length)]
}

/**
 * Get the actual value type from the first character of JSON
 */
function getActualType(char: string): string | null {
  if (!char) return null

  if (char === '"' || char === "'") return "string"
  if (char === "{") return "object"
  if (char === "[") return "array"
  if (char === "t" || char === "f") return "boolean"
  if (char === "u") return "undefined"
  if (char === "n") return "null"
  if (/[0-9-]/.test(char)) return "number"

  return null
}
