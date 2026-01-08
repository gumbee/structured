import type * as z from "zod"

/**
 * Metadata for describing a schema in the registry
 */
export interface DescribeMeta {
  /** Unique identifier for this schema */
  id: string
  /** Human-readable description of the schema */
  description?: string
  /** Alternative names that can reference this schema */
  aliases?: string[]
  /** IDs of schemas this schema depends on */
  dependencies?: string[]
  /** If true, always include this schema in output */
  always?: boolean
  /** If true, this is a utility type (referenced but not exported as top-level) */
  utility?: boolean
  /** Additional rules/constraints for LLM prompts */
  rules?: string
}

/**
 * A schema that can be registered in the describe registry.
 * Now just a Zod type (with optional structured metadata via .alias()/.alternate())
 */
export type DescribableSchema = z.ZodType<any>

/**
 * Entry stored in the registry
 */
export interface RegistryEntry {
  schema: DescribableSchema
  meta: DescribeMeta
}
