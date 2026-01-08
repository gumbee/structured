import type { DescribeMeta, DescribableSchema, RegistryEntry } from "./types"
import { registryToTypescript } from "./typescript"
import { collectSchemaDependencies } from "./dependencies"

/**
 * A custom registry for registering and describing schemas.
 * Supports both ExtendedSchema types from this package and native Zod types.
 */
export class DescribeRegistry {
  private _schemas: Map<string, RegistryEntry> = new Map()
  private _schemaToId: Map<DescribableSchema, string> = new Map()

  /**
   * Register a schema with metadata
   * @param schema - The schema to register (ExtendedSchema or Zod type)
   * @param meta - Metadata describing the schema
   * @returns this for method chaining
   */
  add(schema: DescribableSchema, meta: DescribeMeta): this {
    if (!meta.id) {
      throw new Error("Schema metadata must include an id")
    }

    this._schemas.set(meta.id, { schema, meta })
    this._schemaToId.set(schema, meta.id)

    // Also map aliases to the same ID for lookup
    if (meta.aliases) {
      for (const alias of meta.aliases) {
        // Don't overwrite existing schemas with aliases
        if (!this._schemas.has(alias)) {
          this._schemas.set(alias, { schema, meta })
        }
      }
    }

    return this
  }

  /**
   * Get a schema entry by ID or alias
   * @param id - The schema ID or alias
   * @returns The registry entry or undefined
   */
  get(id: string): RegistryEntry | undefined {
    return this._schemas.get(id)
  }

  /**
   * Get just the schema by ID or alias
   * @param id - The schema ID or alias
   * @returns The schema or undefined
   */
  getSchema(id: string): DescribableSchema | undefined {
    return this._schemas.get(id)?.schema
  }

  /**
   * Get just the metadata by ID or alias
   * @param id - The schema ID or alias
   * @returns The metadata or undefined
   */
  getMeta(id: string): DescribeMeta | undefined {
    return this._schemas.get(id)?.meta
  }

  /**
   * Check if a schema is registered by ID or alias
   * @param id - The schema ID or alias
   * @returns true if the schema exists
   */
  has(id: string): boolean {
    return this._schemas.has(id)
  }

  /**
   * Check if a schema instance is registered
   * @param schema - The schema instance
   * @returns true if the schema is registered
   */
  hasSchema(schema: DescribableSchema): boolean {
    return this._schemaToId.has(schema)
  }

  /**
   * Get the ID for a registered schema instance
   * @param schema - The schema instance
   * @returns The schema ID or undefined
   */
  getIdForSchema(schema: DescribableSchema): string | undefined {
    return this._schemaToId.get(schema)
  }

  /**
   * Remove a schema by ID
   * @param id - The schema ID to remove
   * @returns true if the schema was removed
   */
  remove(id: string): boolean {
    const entry = this._schemas.get(id)
    if (!entry) return false

    // Remove the main entry
    this._schemas.delete(id)
    this._schemaToId.delete(entry.schema)

    // Remove alias entries
    if (entry.meta.aliases) {
      for (const alias of entry.meta.aliases) {
        const aliasEntry = this._schemas.get(alias)
        if (aliasEntry && aliasEntry.schema === entry.schema) {
          this._schemas.delete(alias)
        }
      }
    }

    return true
  }

  /**
   * Get all unique schema entries (excludes alias duplicates)
   * @returns Iterator of registry entries
   */
  *values(): IterableIterator<RegistryEntry> {
    const seen = new Set<DescribableSchema>()
    for (const entry of this._schemas.values()) {
      if (!seen.has(entry.schema)) {
        seen.add(entry.schema)
        yield entry
      }
    }
  }

  /**
   * Get all unique schema entries as [id, entry] pairs (excludes alias duplicates)
   * @returns Iterator of [id, entry] pairs
   */
  *entries(): IterableIterator<[string, RegistryEntry]> {
    const seen = new Set<DescribableSchema>()
    for (const [id, entry] of this._schemas.entries()) {
      if (!seen.has(entry.schema)) {
        seen.add(entry.schema)
        yield [entry.meta.id, entry]
      }
    }
  }

  /**
   * Get all unique schema IDs (excludes aliases)
   * @returns Iterator of schema IDs
   */
  *ids(): IterableIterator<string> {
    const seen = new Set<DescribableSchema>()
    for (const entry of this._schemas.values()) {
      if (!seen.has(entry.schema)) {
        seen.add(entry.schema)
        yield entry.meta.id
      }
    }
  }

  /**
   * Get the number of unique schemas (excludes aliases)
   */
  get size(): number {
    return this._schemaToId.size
  }

  /**
   * Clear all registered schemas
   */
  clear(): void {
    this._schemas.clear()
    this._schemaToId.clear()
  }

  /**
   * Convert all registered schemas to TypeScript type definitions
   * @returns TypeScript code string
   */
  toTypescript(): string {
    return registryToTypescript(this)
  }

  /**
   * Collect all dependencies for the given schema IDs
   * @param schemaIds - The schema IDs to collect dependencies for
   * @returns Array of all schema IDs including dependencies
   */
  collectDependencies(schemaIds: string[]): string[] {
    return collectSchemaDependencies(schemaIds, this)
  }

  /**
   * Create a new registry containing only the specified schemas and their dependencies
   * @param schemaIds - The schema IDs to include
   * @returns A new registry with the trimmed set of schemas
   */
  subset(schemaIds: string[]): DescribeRegistry {
    const allIds = this.collectDependencies(schemaIds)
    const newRegistry = new DescribeRegistry()

    for (const id of allIds) {
      const entry = this.get(id)
      if (entry) {
        newRegistry.add(entry.schema, entry.meta)
      }
    }

    return newRegistry
  }
}
