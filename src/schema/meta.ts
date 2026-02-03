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
 * Information collected from a field schema about aliases and flexible matching.
 */
interface FieldAliasInfo {
  aliases: Set<string>
  normalizer?: (value: any) => any
}

/**
 * Collect aliases and normalizer from all wrapper layers of a schema.
 * This handles cases like z.string().optional().alias(['x']).default('y')
 * where the alias is on an intermediate wrapper.
 * @param schema - The Zod schema that may be wrapped
 * @returns Object containing aliases and optional normalizer
 */
function collectFieldInfoFromAllLayers(schema: z.ZodType): FieldAliasInfo {
  const aliases = new Set<string>()
  let normalizer: ((value: any) => any) | undefined

  function collect(s: z.ZodType): void {
    // Collect meta from this layer
    const meta = getStructuredMeta(s)
    for (const alias of meta.aliases ?? []) {
      aliases.add(alias)
    }
    // Capture normalizer if present (first one found wins)
    if (meta.normalizer && !normalizer) {
      normalizer = meta.normalizer
    }

    // Recurse into wrapped schemas
    if (s instanceof z.ZodOptional) {
      collect((s as z.ZodOptional<z.ZodType>).unwrap())
    } else if (s instanceof z.ZodNullable) {
      collect((s as z.ZodNullable<z.ZodType>).unwrap())
    } else if (s instanceof z.ZodDefault) {
      collect((s as z.ZodDefault<z.ZodType>).removeDefault())
    }
  }

  collect(schema)
  return { aliases, normalizer }
}

/**
 * Extended alias map that includes flexible matching information.
 */
export interface AliasMapInfo {
  /** Exact alias to canonical key map */
  exactAliases: Map<string, string>
  /** Per-field normalizer and canonical/alias keys for flexible matching */
  flexibleFields: Map<string, { canonical: string; allKeys: string[]; normalizer: (value: any) => any }>
}

/**
 * Build an alias map from an object schema's shape
 * Returns a map of alias -> canonical field name, plus flexible matching info
 * @param schema - The ZodObject schema
 * @returns AliasMapInfo with exact aliases and flexible field info
 */
export function buildAliasMap(schema: z.ZodObject<any>): AliasMapInfo {
  const exactAliases = new Map<string, string>()
  const flexibleFields = new Map<string, { canonical: string; allKeys: string[]; normalizer: (value: any) => any }>()
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (fieldSchema instanceof z.ZodType) {
      // Collect aliases and normalizer from all wrapper layers
      const fieldInfo = collectFieldInfoFromAllLayers(fieldSchema as z.ZodType)

      // Add exact aliases
      for (const alias of fieldInfo.aliases) {
        exactAliases.set(alias, key)
      }

      // If there's a normalizer, store for flexible matching
      if (fieldInfo.normalizer) {
        // All keys that can match this field (canonical + aliases)
        const allKeys = [key, ...fieldInfo.aliases]
        // Store with normalized canonical key as lookup
        const normalizedCanonical = fieldInfo.normalizer(key)
        flexibleFields.set(normalizedCanonical, {
          canonical: key,
          allKeys,
          normalizer: fieldInfo.normalizer,
        })
        // Also store normalized aliases for lookup
        for (const alias of fieldInfo.aliases) {
          const normalizedAlias = fieldInfo.normalizer(alias)
          if (normalizedAlias !== normalizedCanonical) {
            flexibleFields.set(normalizedAlias, {
              canonical: key,
              allKeys,
              normalizer: fieldInfo.normalizer,
            })
          }
        }
      }
    }
  }

  return { exactAliases, flexibleFields }
}

/**
 * Resolve a key to its canonical form using an alias map with flexible matching.
 * Priority order:
 * 1. Key is already canonical (no change)
 * 2. Exact alias match
 * 3. Flexible match using normalizer
 *
 * @param key - The key to resolve (may be an alias or flexible variant)
 * @param aliasMapInfo - Extended alias map with flexible matching info
 * @param canonicalKeys - Set of canonical keys in the schema (for checking if key is already canonical)
 * @returns The canonical key
 */
export function resolveKey(key: string, aliasMapInfo: AliasMapInfo, canonicalKeys?: Set<string>): string {
  // 1. Check if key is already canonical
  if (canonicalKeys?.has(key)) {
    return key
  }

  // 2. Try exact alias match
  const exactMatch = aliasMapInfo.exactAliases.get(key)
  if (exactMatch !== undefined) {
    return exactMatch
  }

  // 3. Try flexible match - normalize the input key and look it up
  for (const [normalizedKey, info] of aliasMapInfo.flexibleFields) {
    const normalizedInput = info.normalizer(key)
    if (normalizedInput === normalizedKey) {
      return info.canonical
    }
  }

  // No match found, return as-is
  return key
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
