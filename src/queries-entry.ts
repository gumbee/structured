/**
 * @gumbee/structured/queries
 *
 * Lightweight query utilities for working with structured JSON objects.
 * Use this entry point when you only need completion checking or cleaning,
 * without importing Zod or the parser.
 *
 * This module provides:
 * - `isCompleted` - Check if structured objects/fields are fully parsed
 * - `clean` - Remove internal tracking properties from parsed objects
 *
 * @example
 * ```ts
 * import { isCompleted, clean } from '@gumbee/structured/queries'
 *
 * // Check completion status
 * if (isCompleted(result, 'name')) {
 *   console.log('Name is ready:', result.name)
 * }
 *
 * // Clean internal markers before using
 * const cleanResult = clean(result)
 * ```
 */

export { isCompleted } from "@/utils/queries"
export { clean } from "@/utils/clean"
