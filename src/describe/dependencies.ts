import * as z from "zod"
import type { DescribableSchema } from "@/describe/types"
import type { DescribeRegistry } from "@/describe/registry"
import { getSourceSchema } from "@/schema/meta"

/**
 * Build lookup maps from schema instances to their registry IDs
 */
function buildSchemaMaps(registry: DescribeRegistry): {
  schemaToId: Map<DescribableSchema, string>
} {
  const schemaToId = new Map<DescribableSchema, string>()

  for (const entry of registry.values()) {
    schemaToId.set(entry.schema, entry.meta.id)
  }

  return { schemaToId }
}

/**
 * Resolve a schema to its registered ID, handling clones from .alias()/.flexible()/.describe().
 */
function resolveSchemaId(node: DescribableSchema, schemaToId: Map<DescribableSchema, string>): string | undefined {
  const directId = schemaToId.get(node)
  if (directId) return directId

  if (node instanceof z.ZodType) {
    const source = getSourceSchema(node)
    if (source) {
      const sourceId = schemaToId.get(source)
      if (sourceId) return sourceId
    }

    if (node instanceof z.ZodEnum) {
      const sOptions = (node as any).options as (string | number)[]
      for (const [registered, id] of schemaToId) {
        if (registered instanceof z.ZodEnum) {
          const regOptions = (registered as any).options as (string | number)[]
          if (sOptions.length === regOptions.length && sOptions.every((v, i) => v === regOptions[i])) {
            return id
          }
        }
      }
    }
  }

  return undefined
}

/**
 * Collect direct dependencies from a schema while ignoring z.lazy branches
 */
function collectDirectDependencies(root: DescribableSchema, schemaToId: Map<DescribableSchema, string>): Set<string> {
  const deps = new Set<string>()
  const seen = new Set<any>()

  const enqueueIfKnown = (node: DescribableSchema) => {
    const id = resolveSchemaId(node, schemaToId)
    if (id) deps.add(id)
  }

  const traverse = (node: any) => {
    if (!node) return
    if (seen.has(node)) return
    seen.add(node)

    // Check if this is a registered schema (direct or via source tracking)
    const knownId = resolveSchemaId(node, schemaToId)
    if (knownId) {
      deps.add(knownId)
    }

    // Handle Zod types
    const zodNode = node as z.ZodTypeAny

    // Ignore any z.lazy branches entirely to avoid circular references
    if (zodNode instanceof z.ZodLazy) {
      return
    }

    // Unwrap wrappers and traverse inner schemas
    if (zodNode instanceof z.ZodOptional) {
      const innerType = (zodNode as z.ZodOptional<z.ZodTypeAny>).unwrap()
      const innerId = resolveSchemaId(innerType, schemaToId)
      if (innerId) {
        deps.add(innerId)
      }
      traverse(innerType)
      return
    }

    if (zodNode instanceof z.ZodNullable) {
      const innerType = (zodNode as z.ZodNullable<z.ZodTypeAny>).unwrap()
      const innerId = resolveSchemaId(innerType, schemaToId)
      if (innerId) {
        deps.add(innerId)
      }
      traverse(innerType)
      return
    }

    if (zodNode instanceof z.ZodReadonly) {
      const innerType = (zodNode as any)._def?.innerType
      if (innerType) {
        const innerId = resolveSchemaId(innerType, schemaToId)
        if (innerId) {
          deps.add(innerId)
        }
        traverse(innerType)
      }
      return
    }

    // Generic unwrap for wrappers that expose `_def.innerType`
    if ((zodNode as any)?._def?.innerType) {
      traverse((zodNode as any)._def.innerType)
      return
    }

    // Unwrap effects-like schemas exposing `_def.schema`
    if ((zodNode as any)?._def?.schema) {
      traverse((zodNode as any)._def.schema)
      return
    }

    if (zodNode instanceof z.ZodArray) {
      const elementType = (zodNode as z.ZodArray<z.ZodTypeAny>).element
      if (elementType) {
        const elementId = resolveSchemaId(elementType, schemaToId)
        if (elementId) {
          deps.add(elementId)
        }
        traverse(elementType)
      }
      return
    }

    if (zodNode instanceof z.ZodSet) {
      traverse((zodNode as any)._def.valueType)
      return
    }

    if (zodNode instanceof z.ZodMap) {
      traverse((zodNode as any)._def.keyType)
      traverse((zodNode as any)._def.valueType)
      return
    }

    if (zodNode instanceof z.ZodRecord) {
      traverse((zodNode as any)._def.valueType)
      return
    }

    if (zodNode instanceof z.ZodTuple) {
      for (const item of (zodNode as any)._def.items ?? []) {
        traverse(item)
      }
      if ((zodNode as any)._def.rest) {
        traverse((zodNode as any)._def.rest)
      }
      return
    }

    if (zodNode instanceof z.ZodUnion) {
      for (const opt of (zodNode as any)._def.options) {
        traverse(opt)
      }
      return
    }

    if (zodNode instanceof z.ZodDiscriminatedUnion) {
      for (const opt of (zodNode as any)._def.options.values()) {
        traverse(opt)
      }
      return
    }

    if (zodNode instanceof z.ZodIntersection) {
      traverse((zodNode as any)._def.left)
      traverse((zodNode as any)._def.right)
      return
    }

    if (zodNode instanceof z.ZodPromise) {
      traverse((zodNode as any)._def.type)
      return
    }

    if (zodNode instanceof z.ZodObject) {
      const shape = (zodNode as z.ZodObject<any>).shape
      if (shape && typeof shape === "object") {
        for (const child of Object.values(shape)) {
          const childId = resolveSchemaId(child as DescribableSchema, schemaToId)
          if (childId) {
            deps.add(childId)
          }
          traverse(child)
        }
      }
      return
    }

    // Primitive or unhandled types have no deeper schemas to traverse
  }

  // Seed traversal
  enqueueIfKnown(root)
  traverse(root)

  return deps
}

/**
 * Recursively collect all dependencies for a set of schemas
 * @param schemaIds - The schema IDs to collect dependencies for
 * @param registry - The registry containing schema definitions
 * @param visited - Set of already visited schema IDs (for recursion)
 * @returns Array of all schema IDs including dependencies
 */
export function collectSchemaDependencies(schemaIds: string[], registry: DescribeRegistry, visited: Set<string> = new Set<string>()): string[] {
  const allDependencies = new Set<string>()
  const { schemaToId } = buildSchemaMaps(registry)

  function collect(schemaId: string) {
    if (visited.has(schemaId)) return
    visited.add(schemaId)

    const entry = registry.get(schemaId)
    if (!entry) return

    const { schema, meta } = entry

    // Add explicit dependencies from metadata
    const explicitDeps = meta.dependencies ?? []
    for (const explicitDep of explicitDeps) {
      if (registry.has(explicitDep)) {
        allDependencies.add(explicitDep)
        collect(explicitDep)
      }
    }

    // Collect dependencies from schema structure
    const directDeps = collectDirectDependencies(schema, schemaToId)
    for (const depId of directDeps) {
      if (registry.has(depId)) {
        allDependencies.add(depId)
        collect(depId)
      }
    }
  }

  // Start with the requested schemas
  for (const id of schemaIds) {
    if (registry.has(id)) {
      allDependencies.add(id)
    }
  }

  // Add all "always" schemas
  for (const entry of registry.values()) {
    if (entry.meta.always) {
      allDependencies.add(entry.meta.id)
    } else if (entry.meta.aliases && schemaIds.some((x) => entry.meta.aliases!.includes(x))) {
      allDependencies.add(entry.meta.id)
    }
  }

  // Collect dependencies for all schemas
  for (const id of schemaIds) {
    if (registry.has(id)) {
      collect(id)
    }
  }

  return Array.from(allDependencies)
}
