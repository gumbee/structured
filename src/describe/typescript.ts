import {
  ZodArray,
  ZodBoolean,
  ZodDate,
  ZodEnum,
  ZodLazy,
  ZodLiteral,
  ZodNever,
  ZodNull,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  ZodTuple,
  ZodType,
  ZodUndefined,
  ZodUnion,
} from "zod"
import type { DescribableSchema, DescribeMeta } from "@/describe/types"
import type { DescribeRegistry } from "@/describe/registry"

/**
 * Generate indentation spaces
 */
const space = (depth: number) => " ".repeat(depth)

/**
 * Capitalize a string
 */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Convert a schema ID to a TypeScript type name (PascalCase)
 */
const toTypeName = (id: string) => capitalize(id).replace(/[-_](.)/g, (_, char) => char.toUpperCase())

/**
 * Build a map from Zod schemas to registry IDs
 */
function buildZodToIdMap(registry: DescribeRegistry | undefined): Map<ZodType, string> {
  const zodToId = new Map<ZodType, string>()
  if (registry) {
    for (const entry of registry.values()) {
      zodToId.set(entry.schema, entry.meta.id)
    }
  }
  return zodToId
}

/**
 * Extract description from a schema, unwrapping optional/nullable if needed.
 * This handles cases like z.string().describe("foo").optional() where the
 * description is on the inner type, not the wrapper.
 */
function getSchemaDescription(schema: ZodType): string | undefined {
  // Check if this schema has a description
  if (schema.description) {
    return schema.description
  }
  // Unwrap optional/nullable to find inner description
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return getSchemaDescription(schema.unwrap())
  }
  return undefined
}

/**
 * Convert a schema to a TypeScript type body string (without type declaration)
 * Also collects referenced registry types during traversal
 */
function toTs(
  s: DescribableSchema,
  referential: boolean,
  depth: number,
  registry: DescribeRegistry | undefined,
  zodToId: Map<ZodType, string>,
  referencedTypes: Set<string>,
): string | undefined {
  if (!(s instanceof ZodType)) {
    console.error("Provided schema is not a valid Zod type:", s)
    throw new Error(`Provided schema is not a valid Zod type: ${s}`)
  }

  // Check if this schema is registered in the registry
  const schemaId = zodToId.get(s)
  const meta = schemaId && registry ? registry.getMeta(schemaId) : undefined

  // If schema is not in registry, skip it
  if (schemaId && registry && !registry.has(schemaId)) {
    return undefined
  }

  // If schema has an ID and we want a reference (not defining it), return the type name
  // This applies to both regular and utility schemas - they are referenced by name
  if (schemaId && referential) {
    // Track this as a referenced type
    referencedTypes.add(schemaId)
    return toTypeName(schemaId)
  }

  // Handle different Zod types
  if (s instanceof ZodString) {
    return "string"
  }
  if (s instanceof ZodNumber) {
    return "number"
  }
  if (s instanceof ZodBoolean) {
    return "boolean"
  }
  if (s instanceof ZodDate) {
    return "Date"
  }
  if (s instanceof ZodEnum) {
    return `${s.options.map((o: string | number) => (typeof o === "string" ? `"${o}"` : String(o))).join(" | ")}`
  }
  if (s instanceof ZodUnion) {
    const options = (s as ZodUnion<ZodType[]>).options.map((o: ZodType) => toTs(o, true, depth, registry, zodToId, referencedTypes)).filter(Boolean)

    if (options.length === 0) {
      return undefined
    }

    return `${options.join(" | ")}`
  }
  if (s instanceof ZodLiteral) {
    const value = s.value
    if (typeof value === "string") {
      return `"${value}"`
    }
    return String(value)
  }
  if (s instanceof ZodOptional) {
    const unwrapped = (s as ZodOptional<ZodType>).unwrap()
    if (!unwrapped) return undefined
    // Check if inner type is registered
    const innerId = zodToId.get(unwrapped)
    if (innerId && registry) {
      const innerEntry = registry.get(innerId)
      if (innerEntry) {
        return `${toTs(innerEntry.schema, true, depth, registry, zodToId, referencedTypes)} | undefined`
      }
    }
    return `${toTs(unwrapped, true, depth, registry, zodToId, referencedTypes)} | undefined`
  }
  if (s instanceof ZodNullable) {
    const unwrapped = (s as ZodNullable<ZodType>).unwrap()
    if (!unwrapped) return undefined
    // Check if inner type is registered
    const innerId = zodToId.get(unwrapped)
    if (innerId && registry) {
      const innerEntry = registry.get(innerId)
      if (innerEntry) {
        return `${toTs(innerEntry.schema, true, depth, registry, zodToId, referencedTypes)} | null`
      }
    }
    return `${toTs(unwrapped, true, depth, registry, zodToId, referencedTypes)} | null`
  }
  if (s instanceof ZodNever) {
    return "never"
  }
  if (s instanceof ZodNull) {
    return "null"
  }
  if (s instanceof ZodUndefined) {
    return "undefined"
  }
  if (s instanceof ZodArray) {
    const items = toTs((s as ZodArray<ZodType>).unwrap(), true, depth, registry, zodToId, referencedTypes)
    if (!items) return undefined
    // Only wrap in parentheses if it's a compound type (union or intersection)
    const needsParens = items.includes(" | ") || items.includes(" & ")
    return needsParens ? `(${items})[]` : `${items}[]`
  }
  if (s instanceof ZodLazy) {
    const unwrapped = (s as ZodLazy<ZodType>).unwrap()
    if (!unwrapped) return undefined
    return toTs(unwrapped, true, depth, registry, zodToId, referencedTypes)
  }
  if (s instanceof ZodTuple) {
    const def = (s as any)._def
    const tupleItems = def.items ?? []
    const items = tupleItems.map((item: ZodType) => toTs(item, true, depth, registry, zodToId, referencedTypes)).filter(Boolean)
    return `[${items.join(", ")}]`
  }
  if (s instanceof ZodObject) {
    const indent = 2
    const newDepth = depth + indent

    // Get shape from ZodObject
    const def = (s as any)._def
    const shape = typeof def.shape === "function" ? def.shape() : def.shape

    const entries = Object.entries(shape)
      .map(([key, value]) => {
        const valueSchema = value as DescribableSchema
        const tsType = toTs(valueSchema, true, newDepth, registry, zodToId, referencedTypes)
        // Get description from Zod schema, unwrapping optional/nullable if needed
        const description = valueSchema instanceof ZodType ? getSchemaDescription(valueSchema) : undefined
        return [key, tsType, description] as const
      })
      .filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return undefined
    }

    const properties = entries
      .map(([key, value, description]) => `${space(newDepth)}${key}: ${value}${description ? ` // ${description}` : ""}`)
      .join("\n")

    return `{\n${properties}\n${space(depth)}}`
  }

  return "any"
}

/**
 * Format a JSDoc comment from metadata
 */
function formatJsDoc(meta: Partial<DescribeMeta> | undefined): string {
  if (!meta?.description && !meta?.rules) {
    return ""
  }

  let result = "/**\n"

  if (meta.description) {
    result += ` * ${meta.description.split("\n").join("\n * ")}\n`
  }

  if (meta.rules) {
    result += ` * Rules: ${meta.rules.split("\n").join("\n * ")}\n`
  }

  result += " */\n"
  return result
}

/**
 * Rendered type information including the type definition string
 */
interface RenderedType {
  typeName: string
  typeDefinition: string
  isUtility: boolean
}

/**
 * Internal function to render a schema as a TypeScript type definition.
 * Handles dependency traversal and tracks already-rendered types.
 *
 * @param schema - The schema to render
 * @param meta - Optional metadata for the schema (description, rules)
 * @param typeName - The name for this type
 * @param registry - Optional registry for resolving references
 * @param zodToId - Map from Zod schemas to registry IDs
 * @param alreadyRendered - Set of type names already rendered (to avoid duplicates)
 * @returns Object with list of rendered types (including utility status)
 */
function renderSchemaInternal(
  schema: DescribableSchema,
  meta: Partial<DescribeMeta> | undefined,
  typeName: string,
  registry: DescribeRegistry | undefined,
  zodToId: Map<ZodType, string>,
  alreadyRendered: Set<string>,
): { renderedTypes: RenderedType[] } {
  // If this type was already rendered, skip it
  if (alreadyRendered.has(typeName)) {
    return { renderedTypes: [] }
  }

  // Collect referenced types during traversal
  const referencedTypes = new Set<string>()

  // Convert schema to type body
  const typeBody = toTs(schema, false, 0, registry, zodToId, referencedTypes)

  if (!typeBody) {
    return { renderedTypes: [] }
  }

  // Track all types we render
  const renderedTypes: RenderedType[] = []

  // First, recursively render all referenced types that haven't been rendered yet
  for (const refId of referencedTypes) {
    if (alreadyRendered.has(toTypeName(refId))) {
      continue
    }

    const refEntry = registry?.get(refId)
    if (refEntry) {
      const refResult = renderSchemaInternal(refEntry.schema, refEntry.meta, toTypeName(refEntry.meta.id), registry, zodToId, alreadyRendered)
      renderedTypes.push(...refResult.renderedTypes)
      // Add to alreadyRendered to prevent duplicates in subsequent iterations
      for (const rt of refResult.renderedTypes) {
        alreadyRendered.add(rt.typeName)
      }
    }
  }

  // Now render this type
  const jsDoc = formatJsDoc(meta)
  const typeDefinition = `${jsDoc}type ${typeName} = ${typeBody}\n\n`
  renderedTypes.push({
    typeName,
    typeDefinition,
    isUtility: meta?.utility ?? false,
  })
  alreadyRendered.add(typeName)

  return { renderedTypes }
}

/**
 * Format rendered types into sections (utility types first, then main types)
 * Only adds section headers when both main and utility types are present.
 */
function formatWithSections(renderedTypes: RenderedType[]): string {
  const mainTypes = renderedTypes.filter((t) => !t.isUtility)
  const utilityTypes = renderedTypes.filter((t) => t.isUtility)

  // Only add section headers if we have both main and utility types
  const needsSections = mainTypes.length > 0 && utilityTypes.length > 0

  let result = ""

  // Utility types come first (they are referenced by main types)
  if (utilityTypes.length > 0) {
    if (needsSections) {
      result += "// --- Utility Types ---\n\n"
    }
    for (const t of utilityTypes) {
      result += t.typeDefinition
    }
  }

  if (mainTypes.length > 0) {
    if (needsSections) {
      result += "// --- Main Types ---\n\n"
    }
    for (const t of mainTypes) {
      result += t.typeDefinition
    }
  }

  return result
}

/**
 * Convert a schema to TypeScript type definitions.
 * Includes the main type and any referenced registry types.
 * Utility types are placed in a separate section at the end.
 *
 * @param schema - The schema to convert
 * @param registry - Optional registry containing schema definitions for resolving references
 * @param typeName - Name for the main type (default: "Output")
 * @returns TypeScript code string with type definitions
 */
export function schemaToTypescript(schema: DescribableSchema, registry?: DescribeRegistry, typeName: string = "Output"): string {
  const zodToId = buildZodToIdMap(registry)
  const alreadyRendered = new Set<string>()

  // Check if the schema itself has metadata in the registry
  const schemaId = zodToId.get(schema as ZodType)
  const meta = schemaId && registry ? registry.getMeta(schemaId) : undefined

  const result = renderSchemaInternal(schema, meta, typeName, registry, zodToId, alreadyRendered)

  return formatWithSections(result.renderedTypes).trimEnd()
}

/**
 * Convert all schemas in a registry to TypeScript type definitions.
 * Main types are listed first, followed by utility types in a separate section.
 *
 * @param registry - The registry containing schema definitions
 * @returns TypeScript code string with type definitions
 */
export function registryToTypescript(registry: DescribeRegistry): string {
  const zodToId = buildZodToIdMap(registry)
  const alreadyRendered = new Set<string>()
  const allRenderedTypes: RenderedType[] = []

  for (const entry of registry.values()) {
    const { schema, meta } = entry

    if (!meta.id) {
      throw new Error("Schema metadata must include an id")
    }

    const typeName = toTypeName(meta.id)
    const renderResult = renderSchemaInternal(schema, meta, typeName, registry, zodToId, alreadyRendered)
    allRenderedTypes.push(...renderResult.renderedTypes)
  }

  return formatWithSections(allRenderedTypes).trimEnd()
}
