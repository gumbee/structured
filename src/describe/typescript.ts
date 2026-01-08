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
import type { DescribableSchema } from "./types"
import type { DescribeRegistry } from "./registry"

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
 * Convert a single schema to a TypeScript type string
 * @param registry - The registry containing schema definitions
 * @param schema - The schema to convert
 * @returns TypeScript type string
 */
export function schemaToTypescript(registry: DescribeRegistry, schema: DescribableSchema): string {
  // Build a map from Zod schemas to registry IDs for resolving references
  const zodToId = new Map<ZodType, string>()
  for (const entry of registry.values()) {
    zodToId.set(entry.schema, entry.meta.id)
  }

  function toTs(s: DescribableSchema, referential: boolean, depth: number): string | undefined {
    if (!(s instanceof ZodType)) {
      console.error("Provided schema is not a valid Zod type:", s)
      throw new Error(`Provided schema is not a valid Zod type: ${s}`)
    }

    // Check if this schema is registered in the registry
    const schemaId = zodToId.get(s)
    const meta = schemaId ? registry.getMeta(schemaId) : undefined

    // If schema is not in registry and not a utility, skip it
    if (schemaId && !registry.has(schemaId) && !meta?.utility) {
      return undefined
    }

    // If schema has an ID and we want a reference (not defining it), return the type name
    if (schemaId && referential && !meta?.utility) {
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
      const options = (s as ZodUnion<ZodType[]>).options.map((o: ZodType) => toTs(o, true, depth)).filter(Boolean)

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
      if (innerId) {
        const innerEntry = registry.get(innerId)
        if (innerEntry) {
          return `${toTs(innerEntry.schema, true, depth)} | undefined`
        }
      }
      return `${toTs(unwrapped, true, depth)} | undefined`
    }
    if (s instanceof ZodNullable) {
      const unwrapped = (s as ZodNullable<ZodType>).unwrap()
      if (!unwrapped) return undefined
      // Check if inner type is registered
      const innerId = zodToId.get(unwrapped)
      if (innerId) {
        const innerEntry = registry.get(innerId)
        if (innerEntry) {
          return `${toTs(innerEntry.schema, true, depth)} | null`
        }
      }
      return `${toTs(unwrapped, true, depth)} | null`
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
      const items = toTs((s as ZodArray<ZodType>).unwrap(), true, depth)
      if (!items) return undefined
      return `(${items})[]`
    }
    if (s instanceof ZodLazy) {
      const unwrapped = (s as ZodLazy<ZodType>).unwrap()
      if (!unwrapped) return undefined
      return toTs(unwrapped, true, depth)
    }
    if (s instanceof ZodTuple) {
      const def = (s as any)._def
      const tupleItems = def.items ?? []
      const items = tupleItems.map((item: ZodType) => toTs(item, true, depth)).filter(Boolean)
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
          const tsType = toTs(valueSchema, true, newDepth)
          // Get description from Zod schema using the .description getter
          let description: string | undefined
          if (valueSchema instanceof ZodType) {
            // Zod provides .description as a getter for _def.description
            description = valueSchema.description
          }
          return [key, tsType, description] as const
        })
        .filter(([_, value]) => value !== undefined)

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

  return toTs(schema, false, 0) ?? "any"
}

/**
 * Convert all schemas in a registry to TypeScript type definitions
 * @param registry - The registry containing schema definitions
 * @returns TypeScript code string with type definitions
 */
export function registryToTypescript(registry: DescribeRegistry): string {
  let result = ""

  for (const entry of registry.values()) {
    const { schema, meta } = entry

    if (!meta.id) {
      throw new Error("Schema metadata must include an id")
    }

    const typeAlias = schemaToTypescript(registry, schema)

    let docstring = false

    const startDocstring = () => {
      if (docstring) return
      docstring = true
      result += `/**\n`
    }

    const endDocstring = () => {
      if (!docstring) return
      docstring = false
      result += ` */\n`
    }

    // Add description to JSDoc
    if (meta.description) {
      startDocstring()
      result += ` * ${meta.description.split("\n").join("\n * ")}\n`
    }

    // Add rules to JSDoc
    if (meta.rules) {
      startDocstring()
      result += ` * Rules: ${meta.rules.split("\n").join("\n * ")}\n`
    }

    endDocstring()

    result += `type ${toTypeName(meta.id)} = ${typeAlias}\n\n`
  }

  return result
}
