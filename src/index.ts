/**
 * @gumbee/structured
 *
 * A schema-aware progressive JSON parser that builds structured objects from streamed text.
 * Extends Zod with alias and alternate schema support for flexible parsing.
 *
 * @example
 * ```ts
 * import { z, StructuredJson, clean } from '@gumbee/structured'
 *
 * // Define schema with aliases and alternates
 * const Icon = z.object({
 *   type: z.literal('icon'),
 *   icon: z.string().alias(['name']) // 'name' can be used instead of 'icon'
 * }).alternate(
 *   z.string(), // Accept plain strings
 *   (v) => ({ type: 'icon', icon: v }) // Transform to full object
 * )
 *
 * // Parse progressively
 * const parser = new StructuredJson({
 *   schema: Icon,
 *   onComplete: (result) => console.log(clean(result))
 * })
 *
 * // Stream in chunks
 * parser.process('{"na')
 * parser.process('me": "home"}')
 * // Output: { type: 'icon', icon: 'home' }
 *
 * // Or parse alternate form
 * parser.reset()
 * parser.process('"home"')
 * // Output: { type: 'icon', icon: 'home' }
 * ```
 */

// Schema - re-export Zod with alias/alternate extensions
export * from "./schema"

// Parser
export * from "./parser"

// Utilities
export { clean } from "./utils"
