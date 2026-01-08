/**
 * Cleans a JSON object of all progressive tracking properties (inline)
 */
export function clean<T>(json: T): T {
  if (!json) return json

  if (Array.isArray(json)) {
    return json.map(clean) as T
  } else if (typeof json === "object" && json !== null) {
    return Object.fromEntries(
      Object.entries(json)
        .filter(([key]) => !["__completed", "__done"].includes(key))
        .map(([key, value]) => [key, clean(value)]),
    ) as T
  }

  return json
}
