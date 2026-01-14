/**
 * @gumbee/structured/describe
 *
 * Schema registry and TypeScript generation utilities.
 * Use this entry point for build-time/dev-time tooling.
 *
 * @example
 * ```ts
 * import { DescribeRegistry, registryToTypescript } from '@gumbee/structured/describe'
 * import { z } from '@gumbee/structured/schema'
 *
 * const registry = new DescribeRegistry()
 * registry.add(z.object({ name: z.string() }), { id: 'user' })
 *
 * const typescript = registryToTypescript(registry)
 * ```
 */

// Types
export type { DescribeMeta, DescribableSchema, RegistryEntry } from "@/describe/types"

// Registry
export { DescribeRegistry } from "@/describe/registry"

// TypeScript conversion utilities
export { schemaToTypescript, registryToTypescript } from "@/describe/typescript"

// Dependency collection utilities
export { collectSchemaDependencies } from "@/describe/dependencies"
