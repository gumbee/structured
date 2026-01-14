/**
 * @gumbee/structured/schema
 *
 * Lightweight Zod extensions for structured parsing.
 * Use this entry point when you only need schema extensions without the parser.
 *
 * This module extends Zod schemas with structured parsing capabilities:
 * - `.alias(['name'])` - Add alternative field names for object properties
 * - `.alternate(schema, mapper)` - Add alternative schemas with transformers
 * - `.flexible(normalizer)` - Add normalizer for flexible matching
 * - `dynamic(filter?)` - Create dynamic schemas resolved from registry
 *
 * @example
 * ```ts
 * import { z, dynamic } from '@gumbee/structured/schema'
 *
 * const Icon = z.object({
 *   type: z.literal('icon'),
 *   icon: z.string().alias(['name', 'symbol'])
 * }).alternate(
 *   z.string(),
 *   (v) => ({ type: 'icon', icon: v })
 * )
 * ```
 */

export * from "@/schema"
