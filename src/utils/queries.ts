/**
 * Checks if a structured JSON object (or specific fields within it) has been fully parsed.
 *
 * This function is useful when working with streaming structured outputs where objects
 * are progressively built. It inspects internal markers (`__completed` and `__done`)
 * to determine completion status.
 *
 * @example
 * ```ts
 * // Check if the entire object is complete
 * if (isCompleted(result)) {
 *   console.log("Parsing finished")
 * }
 *
 * // Check if a specific field is complete
 * if (isCompleted(result, "name")) {
 *   console.log("Name field is ready:", result.name)
 * }
 *
 * // Check if multiple fields are complete
 * if (isCompleted(result, ["name", "age"])) {
 *   console.log("Name and age are ready")
 * }
 * ```
 */
export function isCompleted<T>(json: T): boolean
/**
 * Checks if a specific field within the structured object has been fully parsed.
 * @param json - The structured JSON object to check
 * @param field - The field name to check for completion
 */
export function isCompleted<T extends object>(json: T, field?: keyof T): boolean
/**
 * Checks if multiple fields within the structured object have been fully parsed.
 * @param json - The structured JSON object to check
 * @param fields - Array of field names to check for completion
 */
export function isCompleted<T extends object>(json: T, fields?: (keyof T)[]): boolean
export function isCompleted<T>(json: T, field?: keyof T | (keyof T)[]): boolean {
  if (!json) return false

  if (typeof json === "object" && json !== null) {
    if (field != null) {
      const fields = Array.isArray(field) ? field : [field]

      const done: string[] = "__done" in json ? (json.__done as string[]) : []

      return !("__done" in json) || fields.every((field) => done.includes(field as string))
    } else {
      return !("__completed" in json) || json.__completed === true
    }
  } else {
    return true
  }
}
