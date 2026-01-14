import { z } from "@/schema"

export { clean } from "@/utils/clean"
export { isCompleted } from "@/utils/queries"

/**
 * Unwrap optional/nullable/default wrappers to get to the inner schema
 */
export const unwrapSchema = (schema: z.ZodType): z.ZodType => {
  if (schema instanceof z.ZodOptional) {
    return unwrapSchema((schema as z.ZodOptional<z.ZodType>).unwrap())
  }
  if (schema instanceof z.ZodNullable) {
    return unwrapSchema((schema as z.ZodNullable<z.ZodType>).unwrap())
  }
  if (schema instanceof z.ZodDefault) {
    return unwrapSchema((schema as z.ZodDefault<z.ZodType>).removeDefault())
  }
  return schema
}
