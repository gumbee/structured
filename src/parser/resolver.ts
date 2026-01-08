import * as z from "zod"
import { buildAliasMap, dynamic, type DynamicRegistry, getStructuredMeta, isDynamicSchema, resolveKey } from "../schema"

type ResolverOptions = {
  schema?: z.ZodType<any>
  registry?: DynamicRegistry
  /**
   * When true, updates __done keys to use canonical names after alias resolution,
   * and sets __done/__completed on outputs from alternate schema mappers.
   * Should be true when resolving progressive parsing results.
   */
  progressive?: boolean
}

type ResolverResult = {
  schema: z.ZodType<any> | undefined
  output: any
}

/**
 * Update the __done array to reflect transformed keys.
 * When aliases are applied, this replaces aliased keys with their canonical names.
 */
const updateDoneKeys = (output: any, keyMapping: Map<string, string>): void => {
  if (!output || typeof output !== "object" || !output.__done) return

  const newDone: string[] = []
  const seen = new Set<string>()

  for (const key of output.__done as string[]) {
    // Map the key to its canonical name (or keep as-is if no mapping)
    const canonicalKey = keyMapping.get(key) ?? key
    if (!seen.has(canonicalKey)) {
      newDone.push(canonicalKey)
      seen.add(canonicalKey)
    }
  }

  output.__done = newDone
}

/**
 * Set the __done array based on the keys present in the output object.
 * Used when alternates create new objects with different structure.
 */
const setDoneKeysFromOutput = (output: any): void => {
  if (!output || typeof output !== "object" || Array.isArray(output)) return

  // Get all keys except metadata keys
  const keys = Object.keys(output).filter((k) => !k.startsWith("__"))
  output.__done = keys
  output.__completed = true
}

/**
 * Recursively preserves __done and __completed from source to target.
 * Called after Zod safeParse which strips these keys from nested objects.
 */
const preserveProgressiveMetadata = (target: any, source: any): void => {
  if (!target || !source || typeof target !== "object" || typeof source !== "object") return

  if (Array.isArray(target) && Array.isArray(source)) {
    for (let i = 0; i < Math.min(target.length, source.length); i++) {
      preserveProgressiveMetadata(target[i], source[i])
    }
  } else if (!Array.isArray(target) && !Array.isArray(source)) {
    // Restore __done and __completed if present in source
    if (source.__done) target.__done = source.__done
    if (source.__completed !== undefined) target.__completed = source.__completed

    // Recurse into nested objects
    for (const key of Object.keys(target)) {
      if (key === "__done" || key === "__completed") continue
      if (source[key] !== undefined) {
        preserveProgressiveMetadata(target[key], source[key])
      }
    }
  }
}

export const resolve = (object: any, options: ResolverOptions): ResolverResult => {
  const { schema, registry, progressive = false } = options

  // No schema provided - try registry if available, otherwise return as-is
  if (schema === undefined) {
    if (registry) {
      for (const s of registry.values()) {
        const result = tryResolveWith(object, s.schema, registry, progressive)
        if (result) return result
      }
    }
    return { output: object, schema: undefined }
  }

  const meta = getStructuredMeta(schema)
  const isDynamic = isDynamicSchema(schema)
  const filter = meta.dynamicFilter ?? ((v) => true)

  if (isDynamic) {
    // Only throw if explicitly using dynamic() without a registry
    if (!registry) throw new Error("Registry is required for dynamic schema resolution")

    for (const s of registry.values()) {
      if (filter(s)) {
        const result = tryResolveWith(object, s.schema, registry, progressive)

        if (result) return result
      }
    }
  } else {
    const result = tryResolveWith(object, schema, registry, progressive)

    if (result) return result
  }

  return { output: object, schema: undefined }
}

/**
 * Sentinel value to indicate no match (distinct from undefined which is a valid value)
 */
const NO_MATCH = Symbol("NO_MATCH")

/**
 * Unwrap optional/nullable/default wrappers to get to the inner schema
 */
const unwrapSchema = (schema: z.ZodType): z.ZodType => {
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

/**
 * Try to resolve the object with the primary schema (no alternates).
 * Handles alias resolution for objects, normalizer for literals, and recursive resolution.
 * Returns the resolved value if successful, NO_MATCH symbol otherwise.
 */
const tryResolveWithPrimary = (
  object: any,
  schema: z.ZodType<any>,
  registry: DynamicRegistry | undefined,
  progressive: boolean,
): any | typeof NO_MATCH => {
  // Handle undefined - check if schema accepts it via safeParse
  if (object === undefined) {
    // For optional schemas, undefined is valid
    const result = schema.safeParse(object)
    return result.success ? result.data : NO_MATCH
  }

  // Handle null
  if (object === null) {
    const result = schema.safeParse(object)
    return result.success ? result.data : NO_MATCH
  }

  // Unwrap optional/nullable/default wrappers
  const unwrapped = unwrapSchema(schema)

  // Handle dynamic schemas - try each registry schema
  if (isDynamicSchema(unwrapped) || isDynamicSchema(schema)) {
    if (!registry) {
      // No registry - can't resolve dynamic, just pass through
      return object
    }

    const meta = getStructuredMeta(unwrapped) || getStructuredMeta(schema)
    const filter = meta.dynamicFilter ?? (() => true)

    for (const s of registry.values()) {
      if (filter(s)) {
        const result = tryResolveWith(object, s.schema, registry, progressive)
        if (result !== undefined) {
          return result.output
        }
      }
    }

    // No matching schema found - pass through as-is
    return object
  }

  // Handle ZodObject - resolve aliases and recursively resolve properties
  if (unwrapped instanceof z.ZodObject) {
    if (typeof object !== "object" || Array.isArray(object)) {
      return NO_MATCH
    }

    const aliasMap = buildAliasMap(unwrapped)
    const shape = unwrapped.shape
    const resolved: Record<string, any> = {}
    const canonicalKeysPresent = new Set<string>()
    const schemaFieldsMatched = new Set<string>()
    const keyMapping = new Map<string, string>() // Track alias → canonical mappings

    // First pass: resolve all keys (including aliases) to canonical names
    // Canonical keys take precedence over aliases
    for (const [key, value] of Object.entries(object)) {
      const canonicalKey = resolveKey(key, aliasMap)
      const isCanonical = key === canonicalKey

      // Track key mapping for __done updates (only needed in progressive mode)
      if (progressive && key !== canonicalKey) {
        keyMapping.set(key, canonicalKey)
      }

      // Track if this key maps to a schema field
      if (shape[canonicalKey] !== undefined) {
        schemaFieldsMatched.add(canonicalKey)
      }

      if (isCanonical) {
        // Canonical key always wins
        resolved[canonicalKey] = value
        canonicalKeysPresent.add(canonicalKey)
      } else if (!canonicalKeysPresent.has(canonicalKey)) {
        // Alias only used if canonical key isn't present
        resolved[canonicalKey] = value
      }
      // else: alias is ignored because canonical key is present
    }

    // If the input object has keys but none of them match any schema field,
    // this is not a valid match - return NO_MATCH so alternates can be tried.
    // This prevents objects like { type: 'icon', icon: 'star' } from incorrectly
    // matching schemas where all fields are optional.
    const inputHasKeys = Object.keys(object).length > 0
    if (inputHasKeys && schemaFieldsMatched.size === 0) {
      return NO_MATCH
    }

    // Second pass: recursively resolve each property value against its schema
    for (const [key, value] of Object.entries(resolved)) {
      const fieldSchema = shape[key] as z.ZodType | undefined

      if (fieldSchema) {
        // Recursively resolve the value
        const resolvedValue = tryResolveWith(value, fieldSchema, registry, progressive)
        if (resolvedValue !== undefined) {
          resolved[key] = resolvedValue.output
        } else {
          // Value doesn't match schema - fail the whole object
          return NO_MATCH
        }
      }
      // If no field schema, keep the value as-is (extra fields)
    }

    // Validate the resolved object against the schema, preserving extra fields
    const result = unwrapped.passthrough().safeParse(resolved)
    if (result.success) {
      // Preserve __done and __completed from resolved nested objects (safeParse strips them)
      if (progressive) {
        preserveProgressiveMetadata(result.data, resolved)
      }
      // Update __done keys to use canonical names (only in progressive mode)
      if (progressive && keyMapping.size > 0 && result.data.__done) {
        updateDoneKeys(result.data, keyMapping)
      }
      return result.data
    }
    return NO_MATCH
  }

  // Handle ZodArray - recursively resolve each element
  if (unwrapped instanceof z.ZodArray) {
    if (!Array.isArray(object)) {
      return NO_MATCH
    }

    const elementSchema = (unwrapped as z.ZodArray<z.ZodType<any>>).element
    const resolved: any[] = []

    for (const element of object) {
      const resolvedElement = tryResolveWith(element, elementSchema, registry, progressive)
      if (resolvedElement !== undefined) {
        resolved.push(resolvedElement.output)
      } else {
        // Element doesn't match - fail
        return NO_MATCH
      }
    }

    return resolved
  }

  // Handle ZodLiteral with normalizer for flexible matching
  if (unwrapped instanceof z.ZodLiteral) {
    const meta = getStructuredMeta(unwrapped)
    const expected = unwrapped.value

    if (meta.normalizer) {
      // Use normalizer for flexible comparison
      if (meta.normalizer(object) === meta.normalizer(expected)) {
        return expected // Return the canonical value
      }
      return NO_MATCH
    }

    // Standard literal comparison
    return object === expected ? expected : NO_MATCH
  }

  // Handle ZodUnion - try each member
  if (unwrapped instanceof z.ZodUnion) {
    const options = unwrapped.options as z.ZodType[]
    for (const option of options) {
      const result = tryResolveWith(object, option, registry, progressive)
      if (result !== undefined) {
        return result.output
      }
    }
    return NO_MATCH
  }

  // Handle ZodDiscriminatedUnion - try each member
  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    const options = unwrapped.options as z.ZodType[]
    for (const option of options) {
      const result = tryResolveWith(object, option, registry, progressive)
      if (result !== undefined) {
        return result.output
      }
    }
    return NO_MATCH
  }

  // Handle ZodTuple - recursively resolve each element
  if (unwrapped instanceof z.ZodTuple) {
    if (!Array.isArray(object)) {
      return NO_MATCH
    }

    const items = ((unwrapped as any)._def.items ?? []) as z.ZodType[]
    if (object.length !== items.length) {
      return NO_MATCH
    }

    const resolved: any[] = []
    for (let i = 0; i < items.length; i++) {
      const resolvedElement = tryResolveWith(object[i], items[i], registry, progressive)
      if (resolvedElement !== undefined) {
        resolved.push(resolvedElement.output)
      } else {
        return NO_MATCH
      }
    }

    return resolved
  }

  // Handle ZodRecord - recursively resolve each value
  if (unwrapped instanceof z.ZodRecord) {
    if (typeof object !== "object" || Array.isArray(object) || object === null) {
      return NO_MATCH
    }

    // In Zod 4, z.record(keyType, valueType) has valueType property
    const rec = unwrapped as any
    const valueSchema = rec.valueType as z.ZodType | undefined
    if (!valueSchema) {
      // Fall back to standard validation if we can't find the value schema
      const result = unwrapped.safeParse(object)
      return result.success ? result.data : NO_MATCH
    }

    const resolved: Record<string, any> = {}

    for (const [key, value] of Object.entries(object)) {
      const resolvedValue = tryResolveWith(value, valueSchema, registry, progressive)
      if (resolvedValue !== undefined) {
        resolved[key] = resolvedValue.output
      } else {
        return NO_MATCH
      }
    }

    return resolved
  }

  // For all other types (string, number, boolean, etc.), use standard Zod validation
  const result = unwrapped.safeParse(object)
  return result.success ? result.data : NO_MATCH
}

/**
 * Try to resolve the object against the given schema with support for aliased fields and alternate schemas.
 * Returns { output: parsed, schema } if the primary schema matches.
 * Returns { output: alternate.mapper(object), schema } if an alternate matches (returns base schema, not alternate).
 * Returns undefined if neither the schema nor its alternates match.
 *
 * @param progressive - When true, updates __done keys for alias/alternate transformations
 */
export const tryResolveWith = (
  object: any,
  schema: z.ZodType<any>,
  registry?: DynamicRegistry,
  progressive: boolean = false,
): ResolverResult | undefined => {
  // 1. Try to resolve with the primary schema (with alias support)
  const resolved = tryResolveWithPrimary(object, schema, registry, progressive)
  if (resolved !== NO_MATCH) {
    return { output: resolved, schema }
  }

  // 2. Try alternates if primary fails - check both wrapper and unwrapped schema
  const meta = getStructuredMeta(schema)
  for (const alternate of meta.alternates ?? []) {
    const altResult = tryResolveWith(object, alternate.schema, registry, progressive)
    if (altResult !== undefined) {
      // Return the mapped output with the original (base) schema
      const mappedOutput = alternate.mapper(altResult.output)
      // Set __done keys based on the mapped output's structure (only in progressive mode)
      if (progressive) {
        setDoneKeysFromOutput(mappedOutput)
      }
      return { output: mappedOutput, schema }
    }
  }

  // 3. Also check alternates on the unwrapped schema (for optional/nullable wrappers)
  const unwrapped = unwrapSchema(schema)
  if (unwrapped !== schema) {
    const unwrappedMeta = getStructuredMeta(unwrapped)
    for (const alternate of unwrappedMeta.alternates ?? []) {
      const altResult = tryResolveWith(object, alternate.schema, registry, progressive)
      if (altResult !== undefined) {
        // Return the mapped output with the original (base) schema
        const mappedOutput = alternate.mapper(altResult.output)
        // Set __done keys based on the mapped output's structure (only in progressive mode)
        if (progressive) {
          setDoneKeysFromOutput(mappedOutput)
        }
        return { output: mappedOutput, schema }
      }
    }
  }

  return undefined
}
