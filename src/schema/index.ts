/**
 * Schema module - re-exports Zod with alias/alternate extensions
 *
 * This module extends Zod schemas with structured parsing capabilities:
 * - `.alias(['name'])` - Add alternative field names for object properties
 * - `.alternate(schema, mapper)` - Add alternative schemas with transformers
 *
 * @example
 * ```ts
 * import { z } from '@gumbee/structured'
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

// Import meta.ts to apply prototype extensions and re-export z
export { z } from "@/schema/meta"

// Export metadata types and helpers
export * from "@/schema/meta"
