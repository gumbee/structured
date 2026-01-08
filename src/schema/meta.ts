import * as z from "zod"

/**
 * Alternate schema definition - maps a value from an alternative schema to the primary type
 */
export interface AlternateDefinition<T = any, A = any> {
  /** The alternative schema that can be accepted */
  schema: z.ZodType<A>
  /** Function to transform the alternate value to the primary type */
  mapper: (value: A) => T
}

/**
 * Registry entry type for dynamic schema resolution
 * (re-exported from describe/types for convenience)
 */
export interface DynamicRegistryEntry {
  schema: z.ZodType<any>
  meta: { id: string; description?: string; aliases?: string[] }
}

/**
 * Minimal registry interface for dynamic schema resolution.
 * Compatible with DescribeRegistry but avoids circular imports.
 */
export interface DynamicRegistry {
  /** Iterate over unique registry entries */
  values(): IterableIterator<DynamicRegistryEntry>
}

/**
 * Filter function for dynamic schema resolution.
 * Returns true if the schema should be considered as a candidate for matching.
 * @param entry - The registry entry containing schema and metadata
 * @param id - The schema ID
 * @returns true to include this schema in matching candidates
 */
export type DynamicFilter = (entry: DynamicRegistryEntry) => boolean

/**
 * Metadata stored on Zod schemas for structured parsing
 */
export interface StructuredMeta<T = any> {
  /** Field name aliases (for string schemas used in object properties) */
  aliases?: string[]
  /** Alternative schemas with mappers to transform to the primary schema */
  alternates?: AlternateDefinition<T>[]
  /**
   * Normalizer function for flexible matching (especially useful for literals).
   * When set, values are compared using normalizer(input) === normalizer(expected).
   * @example z.literal('section-header').normalize(v => v.toLowerCase().replaceAll('-', ''))
   * // Matches: "section-header", "Section-Header", "SectionHeader", "SECTION-HEADER"
   */
  normalizer?: (value: any) => any
  /**
   * Whether this schema should resolve dynamically from a registry at runtime.
   * When true, the parser will try to match the parsed value against schemas
   * in the registry (filtered by dynamicFilter if provided).
   */
  isDynamic?: boolean
  /**
   * Optional filter to restrict which registry schemas are considered for dynamic matching.
   * Only schemas where this function returns true will be tried.
   */
  dynamicFilter?: DynamicFilter
}

/**
 * Symbol key used to identify structured metadata in Zod's meta
 */
const STRUCTURED_META_KEY = "__structured" as const

/**
 * Internal type for metadata stored in Zod's meta system
 */
interface ZodMetaWithStructured {
  [STRUCTURED_META_KEY]?: StructuredMeta
}

// Module augmentation to add alias(), alternate(), and normalize() methods to all Zod types
declare module "zod" {
  interface ZodType<out Output, out Input, out Internals> {
    /**
     * Add field name aliases for this schema when used as an object property.
     * When parsing, any of these aliases can be used in place of the canonical field name.
     * @param aliases - Array of alternative field names
     * @example z.string().alias(['name', 'label']) // "name" or "label" can be used
     */
    alias(aliases: string[]): this

    /**
     * Add an alternative schema that can be transformed to the primary schema.
     * When parsing, if the primary schema doesn't match, alternates are tried in order.
     * @param schema - The alternative schema to accept
     * @param mapper - Function to transform the alternate value to the primary type
     * @example
     * z.object({ type: z.literal('icon'), icon: z.string() })
     *   .alternate(z.string(), (v) => ({ type: 'icon', icon: v }))
     */
    alternate<A>(schema: z.ZodType<A>, mapper: (value: A) => Output): this

    /**
     * Add a normalizer function for flexible value matching.
     * Values are compared using normalizer(input) === normalizer(expected).
     * Especially useful for case-insensitive literal matching or format variations.
     * @param normalizer - Function to normalize values before comparison
     * @example
     * // Match "section-header", "Section-Header", "SectionHeader", "SECTION-HEADER"
     * z.literal('section-header').flexible(v => v.toLowerCase().replaceAll('-', ''))
     */
    flexible(normalizer: (value: any) => any): this
  }
}

/**
 * Get the current structured metadata from a Zod schema, or empty defaults
 */
function getCurrentStructuredMeta<T>(schema: z.ZodType<T>): StructuredMeta<T> {
  const meta = schema.meta() as ZodMetaWithStructured | undefined
  return meta?.[STRUCTURED_META_KEY] ?? { aliases: [], alternates: [] }
}

/**
 * Create a new schema with updated structured metadata
 */
function withStructuredMeta<T extends z.ZodType>(schema: T, update: Partial<StructuredMeta>): T {
  const current = getCurrentStructuredMeta(schema)
  const newMeta: StructuredMeta = {
    aliases: update.aliases !== undefined ? update.aliases : current.aliases,
    alternates: update.alternates !== undefined ? update.alternates : current.alternates,
    normalizer: update.normalizer !== undefined ? update.normalizer : current.normalizer,
    isDynamic: update.isDynamic !== undefined ? update.isDynamic : current.isDynamic,
    dynamicFilter: update.dynamicFilter !== undefined ? update.dynamicFilter : current.dynamicFilter,
  }

  // Get existing Zod meta and merge with our structured meta
  const existingMeta = (schema.meta() ?? {}) as ZodMetaWithStructured
  return schema.meta({
    ...existingMeta,
    [STRUCTURED_META_KEY]: newMeta,
  }) as T
}

// Add the methods to Zod's prototype
const ZodTypeProto = z.ZodType.prototype as z.ZodType & {
  alias(aliases: string[]): z.ZodType
  alternate<A>(schema: z.ZodType<A>, mapper: (value: A) => any): z.ZodType
  flexible(normalizer: (value: any) => any): z.ZodType
}

ZodTypeProto.alias = function (aliases: string[]) {
  const current = getCurrentStructuredMeta(this)
  return withStructuredMeta(this, {
    aliases: [...(current.aliases ?? []), ...aliases],
  })
}

ZodTypeProto.alternate = function <A>(schema: z.ZodType<A>, mapper: (value: A) => any) {
  const current = getCurrentStructuredMeta(this)
  return withStructuredMeta(this, {
    alternates: [...(current.alternates ?? []), { schema, mapper }],
  })
}

ZodTypeProto.flexible = function (normalizer: (value: any) => any) {
  return withStructuredMeta(this, { normalizer })
}

/**
 * Get structured metadata from a Zod schema
 * Returns empty arrays for aliases/alternates if not set
 * @param schema - The Zod schema to get metadata from
 * @returns The structured metadata
 */
export function getStructuredMeta<T>(schema: z.ZodType<T>): StructuredMeta<T> {
  const meta = getCurrentStructuredMeta(schema)
  return {
    aliases: meta.aliases ?? [],
    alternates: meta.alternates ?? [],
    normalizer: meta.normalizer,
    isDynamic: meta.isDynamic,
    dynamicFilter: meta.dynamicFilter,
  }
}

/**
 * Check if a schema has any structured metadata (aliases or alternates)
 * @param schema - The Zod schema to check
 * @returns true if the schema has aliases or alternates defined
 */
export function hasStructuredMeta(schema: z.ZodType): boolean {
  const meta = getCurrentStructuredMeta(schema)
  return (meta.aliases?.length ?? 0) > 0 || (meta.alternates?.length ?? 0) > 0
}

/**
 * Collect aliases from all wrapper layers of a schema.
 * This handles cases like z.string().optional().alias(['x']).default('y')
 * where the alias is on an intermediate wrapper.
 * @param schema - The Zod schema that may be wrapped
 * @param aliases - Set to collect aliases into
 */
function collectAliasesFromAllLayers(schema: z.ZodType, aliases: Set<string>): void {
  // Collect aliases from this layer
  const meta = getStructuredMeta(schema)
  for (const alias of meta.aliases ?? []) {
    aliases.add(alias)
  }

  // Recurse into wrapped schemas
  if (schema instanceof z.ZodOptional) {
    collectAliasesFromAllLayers((schema as z.ZodOptional<z.ZodType>).unwrap(), aliases)
  } else if (schema instanceof z.ZodNullable) {
    collectAliasesFromAllLayers((schema as z.ZodNullable<z.ZodType>).unwrap(), aliases)
  } else if (schema instanceof z.ZodDefault) {
    collectAliasesFromAllLayers((schema as z.ZodDefault<z.ZodType>).removeDefault(), aliases)
  }
}

/**
 * Build an alias map from an object schema's shape
 * Returns a map of alias -> canonical field name
 * @param schema - The ZodObject schema
 * @returns Map of alias to canonical field name
 */
export function buildAliasMap(schema: z.ZodObject<any>): Map<string, string> {
  const map = new Map<string, string>()
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (fieldSchema instanceof z.ZodType) {
      // Collect aliases from all wrapper layers
      const aliases = new Set<string>()
      collectAliasesFromAllLayers(fieldSchema as z.ZodType, aliases)
      for (const alias of aliases) {
        map.set(alias, key)
      }
    }
  }

  return map
}

/**
 * Resolve a key to its canonical form using an alias map
 * @param key - The key to resolve (may be an alias)
 * @param aliasMap - Map of alias -> canonical key
 * @returns The canonical key
 */
export function resolveKey(key: string, aliasMap: Map<string, string>): string {
  return aliasMap.get(key) ?? key
}

/**
 * Check if a schema is marked as dynamic
 * @param schema - The Zod schema to check
 * @returns true if the schema is dynamic
 */
export function isDynamicSchema(schema: z.ZodType): boolean {
  const meta = getCurrentStructuredMeta(schema)
  return meta.isDynamic === true
}

/**
 * Create a dynamic schema that resolves from a registry at runtime.
 * Acts like z.any() for validation but enables schema-based transformations
 * (aliases, flexible, alternates) when a registry is provided to the parser.
 *
 * @param filter - Optional filter to restrict which registry schemas are considered.
 *                 Only schemas where this function returns true will be tried.
 * @returns A z.any() schema marked as dynamic
 *
 * @example
 * // Accept any widget from registry
 * const anyWidget = dynamic()
 *
 * // Only accept non-error widgets
 * const safeWidget = dynamic((entry, id) => id !== 'Error')
 *
 * // Usage in ListWidget:
 * content: dynamic().array().optional()
 */
export function dynamic(filter?: DynamicFilter): z.ZodAny {
  const schema = z.any()
  return withStructuredMeta(schema, {
    isDynamic: true,
    dynamicFilter: filter,
  })
}

// Re-export z with our extensions applied
export { z }
