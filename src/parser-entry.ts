/**
 * @gumbee/structured/parser
 *
 * Schema-aware progressive JSON parser for streamed text.
 * Use this entry point when you want the parsing capabilities without AI SDK dependencies.
 *
 * This module provides:
 * - `z` - Extended Zod with alias/alternate capabilities for schema building
 * - `StructuredJson` - Main parser class for progressive JSON parsing
 * - `makeStructuredParser` - Factory function to create parsers from Zod schemas
 * - Progressive value classes for handling partial data during streaming
 *
 * @example
 * ```ts
 * import { z, makeStructuredParser } from '@gumbee/structured/parser'
 *
 * const schema = z.object({
 *   name: z.string(),
 *   items: z.array(z.string())
 * })
 *
 * const parser = makeStructuredParser(schema)
 *
 * // Feed chunks progressively
 * parser.push('{"name": "test",')
 * parser.push('"items": ["a", "b"]}')
 *
 * // Get the current parsed value at any point
 * const partial = parser.value
 * ```
 */

export * from "@/parser"

export { z } from "@/schema"
