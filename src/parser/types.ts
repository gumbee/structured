import type * as z from "zod"
import { type DynamicRegistry } from "@/schema/meta"

/**
 * Progressive type that adds metadata to track parsing progress
 */
export type Progressive<T> = T extends object
  ? T & {
      __completed?: boolean
      __done?: string[]
    }
  : T

/**
 * Options for structured parsing
 */
export type StructuredParseOptions = {
  /** Schema to validate and guide parsing */
  schema?: z.ZodType<any>
  /** Registry for dynamic schema resolution */
  registry?: DynamicRegistry
  /** Called when a complete JSON value is parsed */
  onComplete?: (json: any, remainder: string) => void
}
