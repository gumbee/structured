import { describe, it, expect } from "vitest"
import * as z from "zod"
import { resolve, tryResolveWith } from "@/parser/resolver"
import { dynamic, type DynamicRegistry, type DynamicRegistryEntry } from "@/schema/meta"
import "./schema/meta" // Import to apply Zod extensions

describe("tryResolveWith", () => {
  describe("primitives", () => {
    it("should resolve string values", () => {
      const schema = z.string()
      const result = tryResolveWith("hello", schema)

      expect(result).toBeDefined()
      expect(result?.output).toBe("hello")
      expect(result?.schema).toBe(schema)
    })

    it("should resolve number values", () => {
      const schema = z.number()
      const result = tryResolveWith(42, schema)

      expect(result).toBeDefined()
      expect(result?.output).toBe(42)
    })

    it("should resolve boolean values", () => {
      const schema = z.boolean()
      const result = tryResolveWith(true, schema)

      expect(result).toBeDefined()
      expect(result?.output).toBe(true)
    })

    it("should return undefined for non-matching primitives", () => {
      const schema = z.string()
      const result = tryResolveWith(42, schema)

      expect(result).toBeUndefined()
    })

    it("should resolve null for nullable schemas", () => {
      const schema = z.string().nullable()
      const result = tryResolveWith(null, schema)

      expect(result).toBeDefined()
      expect(result?.output).toBe(null)
    })

    it("should resolve undefined for optional schemas", () => {
      const schema = z.string().optional()
      const result = tryResolveWith(undefined, schema)

      expect(result).toBeDefined()
      expect(result?.output).toBe(undefined)
    })
  })

  describe("literals", () => {
    it("should resolve matching literals", () => {
      const schema = z.literal("hello")
      const result = tryResolveWith("hello", schema)

      expect(result).toBeDefined()
      expect(result?.output).toBe("hello")
    })

    it("should return undefined for non-matching literals", () => {
      const schema = z.literal("hello")
      const result = tryResolveWith("world", schema)

      expect(result).toBeUndefined()
    })

    it("should use normalizer for flexible literal matching", () => {
      const schema = z.literal("section-header").flexible((v) => v.toLowerCase().replace(/-/g, ""))

      expect(tryResolveWith("section-header", schema)?.output).toBe("section-header")
      expect(tryResolveWith("Section-Header", schema)?.output).toBe("section-header")
      expect(tryResolveWith("SectionHeader", schema)?.output).toBe("section-header")
      expect(tryResolveWith("SECTION-HEADER", schema)?.output).toBe("section-header")
      expect(tryResolveWith("completely-different", schema)).toBeUndefined()
    })
  })

  describe("objects with aliases", () => {
    it("should resolve objects with canonical field names", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })
      const result = tryResolveWith({ name: "John", age: 30 }, schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual({ name: "John", age: 30 })
    })

    it("should resolve aliased fields to canonical names", () => {
      const schema = z.object({
        text: z.string().alias(["content", "value"]),
      })

      const result1 = tryResolveWith({ content: "hello" }, schema)
      expect(result1).toBeDefined()
      expect(result1?.output).toEqual({ text: "hello" })

      const result2 = tryResolveWith({ value: "world" }, schema)
      expect(result2).toBeDefined()
      expect(result2?.output).toEqual({ text: "world" })
    })

    it("should prefer canonical name over alias", () => {
      const schema = z.object({
        text: z.string().alias(["content"]),
      })

      const result = tryResolveWith({ text: "canonical" }, schema)
      expect(result?.output).toEqual({ text: "canonical" })
    })

    it("should resolve nested objects with aliases", () => {
      const schema = z.object({
        user: z.object({
          name: z.string().alias(["username", "displayName"]),
        }),
      })

      const result = tryResolveWith({ user: { displayName: "John" } }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ user: { name: "John" } })
    })

    it("should return undefined for missing required fields", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const result = tryResolveWith({ name: "John" }, schema)
      expect(result).toBeUndefined()
    })

    it("should handle optional fields with aliases", () => {
      const schema = z.object({
        title: z.string(),
        subtitle: z.string().optional().alias(["description"]),
      })

      const result1 = tryResolveWith({ title: "Hello" }, schema)
      expect(result1).toBeDefined()
      expect(result1?.output).toEqual({ title: "Hello" })

      const result2 = tryResolveWith({ title: "Hello", description: "World" }, schema)
      expect(result2).toBeDefined()
      expect(result2?.output).toEqual({ title: "Hello", subtitle: "World" })
    })
  })

  describe("alternate schemas", () => {
    it("should resolve primary schema first", () => {
      const schema = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const result = tryResolveWith({ type: "text", text: "hello" }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ type: "text", text: "hello" })
      expect(result?.schema).toBe(schema) // Returns base schema
    })

    it("should fallback to alternate when primary fails", () => {
      const schema = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const result = tryResolveWith("hello world", schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ type: "text", text: "hello world" })
      expect(result?.schema).toBe(schema) // Returns base schema, not alternate
    })

    it("should try alternates in order", () => {
      const schema = z
        .object({
          type: z.literal("widget"),
          data: z.any(),
        })
        .alternate(z.number(), (v) => ({ type: "widget", data: `number: ${v}` }))
        .alternate(z.string(), (v) => ({ type: "widget", data: `string: ${v}` }))

      const numResult = tryResolveWith(42, schema)
      expect(numResult?.output).toEqual({ type: "widget", data: "number: 42" })

      const strResult = tryResolveWith("hello", schema)
      expect(strResult?.output).toEqual({ type: "widget", data: "string: hello" })
    })

    it("should resolve alternate with nested object schema", () => {
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
        })
        .alternate(z.object({ supericon: z.string() }), (v) => ({ type: "icon", icon: v.supericon }))

      const result = tryResolveWith({ supericon: "star" }, IconWidget)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ type: "icon", icon: "star" })
    })

    it("should resolve alternate with aliases in the alternate schema", () => {
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
        })
        .alternate(z.object({ name: z.string().alias(["iconName"]) }), (v) => ({ type: "icon", icon: v.name }))

      const result = tryResolveWith({ iconName: "star" }, IconWidget)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ type: "icon", icon: "star" })
    })
  })

  describe("arrays", () => {
    it("should resolve arrays of primitives", () => {
      const schema = z.array(z.string())
      const result = tryResolveWith(["a", "b", "c"], schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual(["a", "b", "c"])
    })

    it("should resolve arrays of objects with aliases", () => {
      const schema = z.array(
        z.object({
          name: z.string().alias(["title"]),
        }),
      )

      const result = tryResolveWith([{ title: "First" }, { name: "Second" }], schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual([{ name: "First" }, { name: "Second" }])
    })

    it("should resolve arrays with alternate element schema", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const schema = z.array(TextWidget)

      const result = tryResolveWith(["hello", { type: "text", text: "world" }], schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ])
    })

    it("should return undefined if any element fails", () => {
      const schema = z.array(z.string())
      const result = tryResolveWith(["a", 42, "c"], schema)

      expect(result).toBeUndefined()
    })
  })

  describe("unions", () => {
    it("should resolve matching union member", () => {
      const schema = z.union([z.string(), z.number()])

      expect(tryResolveWith("hello", schema)?.output).toBe("hello")
      expect(tryResolveWith(42, schema)?.output).toBe(42)
    })

    it("should return undefined for non-matching union", () => {
      const schema = z.union([z.string(), z.number()])
      const result = tryResolveWith(true, schema)

      expect(result).toBeUndefined()
    })

    it("should resolve union of objects with aliases", () => {
      const schema = z.union([
        z.object({ type: z.literal("a"), value: z.string().alias(["v"]) }),
        z.object({ type: z.literal("b"), count: z.number().alias(["n"]) }),
      ])

      const result1 = tryResolveWith({ type: "a", v: "hello" }, schema)
      expect(result1?.output).toEqual({ type: "a", value: "hello" })

      const result2 = tryResolveWith({ type: "b", n: 42 }, schema)
      expect(result2?.output).toEqual({ type: "b", count: 42 })
    })
  })

  describe("nested complex structures", () => {
    it("should resolve deeply nested structures with aliases and alternates", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string().alias(["content", "value"]),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const ListWidget = z.object({
        type: z.literal("list"),
        items: z
          .object({
            title: z.string().optional().alias(["label", "name"]),
            content: z.array(TextWidget).optional().alias(["children"]),
          })
          .array()
          .alias(["entries"]),
      })

      const input = {
        type: "list",
        entries: [
          { label: "Item 1", children: ["Content 1"] },
          { title: "Item 2", content: [{ type: "text", value: "Content 2" }] },
        ],
      }

      const result = tryResolveWith(input, ListWidget)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({
        type: "list",
        items: [
          { title: "Item 1", content: [{ type: "text", text: "Content 1" }] },
          { title: "Item 2", content: [{ type: "text", text: "Content 2" }] },
        ],
      })
    })

    it("should handle optional nested objects with alternates", () => {
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
        })
        .alternate(z.object({ iconName: z.string() }), (v) => ({ type: "icon", icon: v.iconName }))

      const HeaderWidget = z.object({
        type: z.literal("header"),
        title: z.string(),
        icon: IconWidget.optional(),
      })

      const result = tryResolveWith(
        {
          type: "header",
          title: "My Header",
          icon: { iconName: "star" },
        },
        HeaderWidget,
      )

      expect(result).toBeDefined()
      expect(result?.output).toEqual({
        type: "header",
        title: "My Header",
        icon: { type: "icon", icon: "star" },
      })
    })
  })

  describe("records", () => {
    it("should resolve records with primitive values", () => {
      const schema = z.record(z.string(), z.number())
      const result = tryResolveWith({ a: 1, b: 2, c: 3 }, schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual({ a: 1, b: 2, c: 3 })
    })

    it("should resolve records with complex values", () => {
      const Widget = z
        .object({
          type: z.literal("widget"),
          value: z.string().alias(["v"]),
        })
        .alternate(z.string(), (v) => ({ type: "widget", value: v }))

      const schema = z.record(z.string(), Widget)
      const result = tryResolveWith(
        {
          first: "simple",
          second: { type: "widget", v: "aliased" },
        },
        schema,
      )

      expect(result).toBeDefined()
      expect(result?.output).toEqual({
        first: { type: "widget", value: "simple" },
        second: { type: "widget", value: "aliased" },
      })
    })
  })

  describe("tuples", () => {
    it("should resolve tuples", () => {
      const schema = z.tuple([z.string(), z.number(), z.boolean()])
      const result = tryResolveWith(["hello", 42, true], schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual(["hello", 42, true])
    })

    it("should return undefined for wrong tuple length", () => {
      const schema = z.tuple([z.string(), z.number()])

      expect(tryResolveWith(["hello"], schema)).toBeUndefined()
      expect(tryResolveWith(["hello", 42, true], schema)).toBeUndefined()
    })

    it("should resolve tuples with complex elements", () => {
      const TextWidget = z.object({ type: z.literal("text"), text: z.string() }).alternate(z.string(), (v) => ({ type: "text", text: v }))

      const schema = z.tuple([TextWidget, z.number()])
      const result = tryResolveWith(["hello", 42], schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual([{ type: "text", text: "hello" }, 42])
    })
  })

  describe("edge cases", () => {
    it("should handle empty objects", () => {
      const schema = z.object({})
      const result = tryResolveWith({}, schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual({})
    })

    it("should handle empty arrays", () => {
      const schema = z.array(z.string())
      const result = tryResolveWith([], schema)

      expect(result).toBeDefined()
      expect(result?.output).toEqual([])
    })

    it("should preserve extra fields from objects", () => {
      const schema = z.object({
        name: z.string(),
      })
      const result = tryResolveWith({ name: "John", extra: "field" }, schema)

      expect(result).toBeDefined()
      // Extra fields are preserved (passthrough behavior)
      expect(result?.output).toEqual({ name: "John", extra: "field" })
    })

    it("should preserve extra fields from objects even with aliases", () => {
      const schema = z.object({
        name: z.string().alias(["username"]),
      })
      const result = tryResolveWith({ username: "John", extra: "field" }, schema)

      expect(result).toBeDefined()
      // Extra fields are preserved (passthrough behavior)
      expect(result?.output).toEqual({ name: "John", extra: "field" })
    })

    it("should handle defaults", () => {
      const schema = z.object({
        name: z.string().default("Anonymous"),
      })

      const result = tryResolveWith({}, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ name: "Anonymous" })
    })

    it("should handle optional fields with defaults", () => {
      const schema = z.object({
        type: z.literal("user"),
        name: z.string().optional().alias(["username"]).default("Anonymous"),
      })

      const result = tryResolveWith({ type: "user", username: "John" }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ type: "user", name: "John" })
    })

    it("should handle nullable fields with aliases", () => {
      const schema = z.object({
        name: z.string().nullable().alias(["username"]),
      })

      const result1 = tryResolveWith({ username: null }, schema)
      expect(result1).toBeDefined()
      expect(result1?.output).toEqual({ name: null })

      const result2 = tryResolveWith({ username: "John" }, schema)
      expect(result2).toBeDefined()
      expect(result2?.output).toEqual({ name: "John" })
    })

    it("should handle deeply chained wrappers with aliases", () => {
      const schema = z.object({
        value: z.string().optional().nullable().alias(["v"]).default("fallback"),
      })

      // Alias with value
      const result1 = tryResolveWith({ v: "hello" }, schema)
      expect(result1?.output).toEqual({ value: "hello" })

      // Alias with null
      const result2 = tryResolveWith({ v: null }, schema)
      expect(result2?.output).toEqual({ value: null })

      // Missing field uses default
      const result3 = tryResolveWith({}, schema)
      expect(result3?.output).toEqual({ value: "fallback" })
    })

    it("should prefer canonical name when both canonical and alias are present", () => {
      const schema = z.object({
        name: z.string().alias(["username"]),
      })

      // When both canonical and alias are present, the canonical value wins
      const result = tryResolveWith({ name: "Canonical", username: "Aliased" }, schema)
      expect(result).toBeDefined()
      expect(result?.output.name).toBe("Canonical")
    })

    it("should handle alias on inner schema before wrappers", () => {
      // Alias defined before .optional() - should still work
      const schema = z.object({
        name: z.string().alias(["username"]).optional(),
      })

      const result = tryResolveWith({ username: "John" }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ name: "John" })
    })

    it("should handle falsy values correctly", () => {
      const schema = z.object({
        str: z.string(),
        num: z.number(),
        bool: z.boolean(),
      })

      const result = tryResolveWith({ str: "", num: 0, bool: false }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ str: "", num: 0, bool: false })
    })

    it("should handle falsy values with aliases", () => {
      const schema = z.object({
        count: z.number().alias(["n"]),
        enabled: z.boolean().alias(["on"]),
      })

      const result = tryResolveWith({ n: 0, on: false }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ count: 0, enabled: false })
    })
  })

  describe("discriminated unions", () => {
    it("should resolve discriminated union by discriminator", () => {
      const schema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), content: z.string() }),
        z.object({ type: z.literal("image"), url: z.string() }),
      ])

      const textResult = tryResolveWith({ type: "text", content: "hello" }, schema)
      expect(textResult).toBeDefined()
      expect(textResult?.output).toEqual({ type: "text", content: "hello" })

      const imageResult = tryResolveWith({ type: "image", url: "http://example.com" }, schema)
      expect(imageResult).toBeDefined()
      expect(imageResult?.output).toEqual({ type: "image", url: "http://example.com" })
    })

    it("should resolve discriminated union with aliases in members", () => {
      const schema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), content: z.string().alias(["text", "value"]) }),
        z.object({ type: z.literal("link"), url: z.string().alias(["href"]) }),
      ])

      const result1 = tryResolveWith({ type: "text", value: "hello" }, schema)
      expect(result1?.output).toEqual({ type: "text", content: "hello" })

      const result2 = tryResolveWith({ type: "link", href: "http://example.com" }, schema)
      expect(result2?.output).toEqual({ type: "link", url: "http://example.com" })
    })

    it("should return undefined for non-matching discriminated union", () => {
      const schema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("a"), value: z.string() }),
        z.object({ type: z.literal("b"), value: z.number() }),
      ])

      const result = tryResolveWith({ type: "c", value: "test" }, schema)
      expect(result).toBeUndefined()
    })
  })

  describe("enums", () => {
    it("should resolve matching enum values", () => {
      const schema = z.enum(["small", "medium", "large"])

      expect(tryResolveWith("small", schema)?.output).toBe("small")
      expect(tryResolveWith("medium", schema)?.output).toBe("medium")
      expect(tryResolveWith("large", schema)?.output).toBe("large")
    })

    it("should return undefined for non-matching enum values", () => {
      const schema = z.enum(["small", "medium", "large"])

      expect(tryResolveWith("tiny", schema)).toBeUndefined()
      expect(tryResolveWith("xl", schema)).toBeUndefined()
    })

    it("should resolve objects with enum fields and aliases", () => {
      const schema = z.object({
        size: z.enum(["s", "m", "l"]).alias(["sz"]),
      })

      const result = tryResolveWith({ sz: "m" }, schema)
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ size: "m" })
    })
  })

  describe("alternates with wrappers", () => {
    it("should resolve optional schema with alternates", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const schema = z.object({
        title: z.string(),
        content: TextWidget.optional(),
      })

      // With alternate value
      const result1 = tryResolveWith({ title: "Hello", content: "world" }, schema)
      expect(result1?.output).toEqual({
        title: "Hello",
        content: { type: "text", text: "world" },
      })

      // With primary value
      const result2 = tryResolveWith({ title: "Hello", content: { type: "text", text: "world" } }, schema)
      expect(result2?.output).toEqual({
        title: "Hello",
        content: { type: "text", text: "world" },
      })

      // Without optional field
      const result3 = tryResolveWith({ title: "Hello" }, schema)
      expect(result3?.output).toEqual({ title: "Hello" })
    })

    it("should resolve nullable schema with alternates", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const schema = z.object({
        content: TextWidget.nullable(),
      })

      // With alternate value
      const result1 = tryResolveWith({ content: "hello" }, schema)
      expect(result1?.output).toEqual({ content: { type: "text", text: "hello" } })

      // With null
      const result2 = tryResolveWith({ content: null }, schema)
      expect(result2?.output).toEqual({ content: null })
    })
  })
})

/**
 * Helper to create a DynamicRegistry from an array of entries
 */
function createRegistry(entries: DynamicRegistryEntry[]): DynamicRegistry {
  return {
    values: function* () {
      for (const entry of entries) {
        yield entry
      }
    },
  }
}

describe("resolve", () => {
  describe("no schema / no registry", () => {
    it("should return object with undefined schema when no schema and no registry provided", () => {
      const object = { foo: "bar" }
      const result = resolve(object, {})

      expect(result.output).toEqual(object)
      expect(result.schema).toBeUndefined()
    })
  })

  describe("static schema (non-dynamic)", () => {
    it("should resolve with static schema when it matches", () => {
      const schema = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const object = { type: "text", text: "hello" }
      const result = resolve(object, { schema })

      expect(result.output).toEqual(object)
      expect(result.schema).toBe(schema)
    })

    it("should resolve static schema with aliases", () => {
      const schema = z.object({
        type: z.literal("text"),
        text: z.string().alias(["content"]),
      })
      const object = { type: "text", content: "hello" }
      const result = resolve(object, { schema })

      expect(result.output).toEqual({ type: "text", text: "hello" })
      expect(result.schema).toBe(schema)
    })

    it("should resolve static schema with alternates", () => {
      const schema = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const result = resolve("hello world", { schema })

      expect(result.output).toEqual({ type: "text", text: "hello world" })
      expect(result.schema).toBe(schema)
    })

    it("should return undefined schema when static schema does not match", () => {
      const schema = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const object = { type: "image", url: "http://example.com" }
      const result = resolve(object, { schema })

      expect(result.output).toEqual(object)
      expect(result.schema).toBeUndefined()
    })
  })

  describe("dynamic schema resolution", () => {
    it("should throw error when dynamic schema used without registry", () => {
      const object = { type: "text", text: "hello" }

      expect(() => resolve(object, { schema: dynamic() })).toThrow("Registry is required for dynamic schema resolution")
    })

    it("should resolve dynamic schema by trying registry schemas in order", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const ImageWidget = z.object({
        type: z.literal("image"),
        url: z.string(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ImageWidget, meta: { id: "Image" } },
      ])

      const textResult = resolve({ type: "text", text: "hello" }, { schema: dynamic(), registry })
      expect(textResult.output).toEqual({ type: "text", text: "hello" })
      expect(textResult.schema).toBe(TextWidget)

      const imageResult = resolve({ type: "image", url: "http://example.com" }, { schema: dynamic(), registry })
      expect(imageResult.output).toEqual({ type: "image", url: "http://example.com" })
      expect(imageResult.schema).toBe(ImageWidget)
    })

    it("should use first matching schema when multiple could match", () => {
      // Both schemas would match the object, but first should win
      const GenericWidget = z.object({
        type: z.string(),
      })
      const SpecificWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })

      const registry = createRegistry([
        { schema: GenericWidget, meta: { id: "Generic" } },
        { schema: SpecificWidget, meta: { id: "Specific" } },
      ])

      const result = resolve({ type: "text", text: "hello" }, { schema: dynamic(), registry })
      expect(result.schema).toBe(GenericWidget)
    })

    it("should resolve dynamic schema with aliases from registry schema", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string().alias(["content", "value"]),
      })

      const registry = createRegistry([{ schema: TextWidget, meta: { id: "Text" } }])

      const result = resolve({ type: "text", content: "hello" }, { schema: dynamic(), registry })
      expect(result.output).toEqual({ type: "text", text: "hello" })
      expect(result.schema).toBe(TextWidget)
    })

    it("should resolve dynamic schema with alternates from registry schema", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const registry = createRegistry([{ schema: TextWidget, meta: { id: "Text" } }])

      const result = resolve("hello world", { schema: dynamic(), registry })
      expect(result.output).toEqual({ type: "text", text: "hello world" })
      expect(result.schema).toBe(TextWidget)
    })

    it("should return undefined schema when no registry schema matches", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })

      const registry = createRegistry([{ schema: TextWidget, meta: { id: "Text" } }])

      const result = resolve({ type: "unknown", data: 123 }, { schema: dynamic(), registry })
      expect(result.output).toEqual({ type: "unknown", data: 123 })
      expect(result.schema).toBeUndefined()
    })

    it("should return undefined schema when registry is empty", () => {
      const registry = createRegistry([])

      const result = resolve({ type: "text", text: "hello" }, { schema: dynamic(), registry })
      expect(result.output).toEqual({ type: "text", text: "hello" })
      expect(result.schema).toBeUndefined()
    })
  })

  describe("dynamic schema with filter", () => {
    it("should only try schemas that pass the filter", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const ImageWidget = z.object({
        type: z.literal("image"),
        url: z.string(),
      })
      const ErrorWidget = z.object({
        type: z.literal("error"),
        message: z.string(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ImageWidget, meta: { id: "Image" } },
        { schema: ErrorWidget, meta: { id: "Error" } },
      ])

      // Filter that excludes Error widget
      const safeSchema = dynamic((entry) => entry.meta.id !== "Error")

      // Should match text
      const textResult = resolve({ type: "text", text: "hello" }, { schema: safeSchema, registry })
      expect(textResult.schema).toBe(TextWidget)

      // Should NOT match error (filtered out)
      const errorResult = resolve({ type: "error", message: "oops" }, { schema: safeSchema, registry })
      expect(errorResult.schema).toBeUndefined()
    })

    it("should pass full entry to filter function", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const RichTextWidget = z.object({
        type: z.literal("richtext"),
        html: z.string(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text", description: "Simple text" } },
        { schema: RichTextWidget, meta: { id: "RichText", description: "Rich HTML text", aliases: ["html-text"] } },
      ])

      // Filter that only includes widgets with aliases
      const aliasedSchema = dynamic((entry) => (entry.meta.aliases?.length ?? 0) > 0)

      // Text widget has no aliases - should not match even if object matches
      const textResult = resolve({ type: "text", text: "hello" }, { schema: aliasedSchema, registry })
      expect(textResult.schema).toBeUndefined()

      // RichText widget has aliases - should match
      const richResult = resolve({ type: "richtext", html: "<p>Hello</p>" }, { schema: aliasedSchema, registry })
      expect(richResult.schema).toBe(RichTextWidget)
    })

    it("should try all non-filtered schemas in order", () => {
      const AWidget = z.object({ type: z.literal("a") })
      const BWidget = z.object({ type: z.literal("b") })
      const CWidget = z.object({ type: z.literal("c") })

      const registry = createRegistry([
        { schema: AWidget, meta: { id: "A" } },
        { schema: BWidget, meta: { id: "B" } },
        { schema: CWidget, meta: { id: "C" } },
      ])

      // Filter that excludes B
      const filteredSchema = dynamic((entry) => entry.meta.id !== "B")

      const resultC = resolve({ type: "c" }, { schema: filteredSchema, registry })
      expect(resultC.schema).toBe(CWidget)
    })
  })

  describe("default schema behavior", () => {
    it("should use dynamic() as default when no schema provided but registry exists", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })

      const registry = createRegistry([{ schema: TextWidget, meta: { id: "Text" } }])

      // No schema provided, but registry exists - should try dynamic resolution
      const result = resolve({ type: "text", text: "hello" }, { registry })
      expect(result.output).toEqual({ type: "text", text: "hello" })
      expect(result.schema).toBe(TextWidget)
    })
  })

  describe("complex dynamic scenarios", () => {
    it("should resolve nested structures with dynamic schemas from registry", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const IconWidget = z.object({
        type: z.literal("icon"),
        icon: z.string(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: IconWidget, meta: { id: "Icon" } },
      ])

      // Both text and icon should be resolvable
      const textResult = resolve({ type: "text", text: "hello" }, { schema: dynamic(), registry })
      expect(textResult.schema).toBe(TextWidget)

      const iconResult = resolve({ type: "icon", icon: "star" }, { schema: dynamic(), registry })
      expect(iconResult.schema).toBe(IconWidget)
    })

    it("should resolve with combined aliases, alternates, and flexible matching from registry", () => {
      const HeaderWidget = z
        .object({
          type: z.literal("section-header").flexible((v) => v.toLowerCase().replace(/-/g, "")),
          title: z.string().alias(["text", "label"]),
        })
        .alternate(z.string(), (v) => ({ type: "section-header", title: v }))

      const registry = createRegistry([{ schema: HeaderWidget, meta: { id: "Header" } }])

      // Match via flexible literal
      const flexibleResult = resolve({ type: "SectionHeader", label: "Hello" }, { schema: dynamic(), registry })
      expect(flexibleResult.output).toEqual({ type: "section-header", title: "Hello" })
      expect(flexibleResult.schema).toBe(HeaderWidget)

      // Match via alternate
      const alternateResult = resolve("Hello World", { schema: dynamic(), registry })
      expect(alternateResult.output).toEqual({ type: "section-header", title: "Hello World" })
      expect(alternateResult.schema).toBe(HeaderWidget)
    })
  })

  describe("nested dynamic schemas", () => {
    it("should resolve dynamic array elements from registry", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const ImageWidget = z.object({
        type: z.literal("image"),
        url: z.string(),
      })
      const ListWidget = z.object({
        type: z.literal("list"),
        items: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ImageWidget, meta: { id: "Image" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      const input = {
        type: "list",
        items: [
          { type: "text", text: "hello" },
          { type: "image", url: "http://example.com/img.png" },
        ],
      }

      const result = resolve(input, { schema: ListWidget, registry })
      expect(result.output).toEqual({
        type: "list",
        items: [
          { type: "text", text: "hello" },
          { type: "image", url: "http://example.com/img.png" },
        ],
      })
      expect(result.schema).toBe(ListWidget)
    })

    it("should resolve dynamic array elements with aliases from registry", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string().alias(["content", "value"]),
      })
      const ListWidget = z.object({
        type: z.literal("list"),
        items: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      const input = {
        type: "list",
        items: [
          { type: "text", content: "hello" },
          { type: "text", value: "world" },
        ],
      }

      const result = resolve(input, { schema: ListWidget, registry })
      expect(result.output).toEqual({
        type: "list",
        items: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      })
    })

    it("should resolve dynamic array elements with alternates from registry", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const ListWidget = z.object({
        type: z.literal("list"),
        items: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      const input = {
        type: "list",
        items: ["hello", "world", { type: "text", text: "explicit" }],
      }

      const result = resolve(input, { schema: ListWidget, registry })
      expect(result.output).toEqual({
        type: "list",
        items: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
          { type: "text", text: "explicit" },
        ],
      })
    })

    it("should resolve nested lists with dynamic content", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const ListWidget = z.object({
        type: z.literal("list"),
        items: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      // Nested list structure
      const input = {
        type: "list",
        items: [
          { type: "text", text: "first" },
          {
            type: "list",
            items: [
              { type: "text", text: "nested-1" },
              { type: "text", text: "nested-2" },
            ],
          },
        ],
      }

      const result = resolve(input, { schema: ListWidget, registry })
      expect(result.output).toEqual({
        type: "list",
        items: [
          { type: "text", text: "first" },
          {
            type: "list",
            items: [
              { type: "text", text: "nested-1" },
              { type: "text", text: "nested-2" },
            ],
          },
        ],
      })
    })

    it("should resolve optional dynamic fields from registry", () => {
      const IconWidget = z.object({
        type: z.literal("icon"),
        icon: z.string(),
      })
      const HeaderWidget = z.object({
        type: z.literal("header"),
        title: z.string(),
        icon: dynamic().optional(),
      })

      const registry = createRegistry([
        { schema: IconWidget, meta: { id: "Icon" } },
        { schema: HeaderWidget, meta: { id: "Header" } },
      ])

      // With icon
      const withIcon = resolve({ type: "header", title: "Hello", icon: { type: "icon", icon: "star" } }, { schema: HeaderWidget, registry })
      expect(withIcon.output).toEqual({
        type: "header",
        title: "Hello",
        icon: { type: "icon", icon: "star" },
      })

      // Without icon
      const withoutIcon = resolve({ type: "header", title: "Hello" }, { schema: HeaderWidget, registry })
      expect(withoutIcon.output).toEqual({ type: "header", title: "Hello" })
    })

    it("should resolve dynamic fields with filter from registry", () => {
      const TextWidget = z.object({
        type: z.literal("text"),
        text: z.string(),
      })
      const ErrorWidget = z.object({
        type: z.literal("error"),
        message: z.string(),
      })

      // ListWidget only accepts non-error widgets
      const ListWidget = z.object({
        type: z.literal("list"),
        items: dynamic((entry) => entry.meta.id !== "Error").array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ErrorWidget, meta: { id: "Error" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      // Text should be accepted
      const validInput = {
        type: "list",
        items: [{ type: "text", text: "hello" }],
      }
      const validResult = resolve(validInput, { schema: ListWidget, registry })
      expect(validResult.output).toEqual({
        type: "list",
        items: [{ type: "text", text: "hello" }],
      })

      // Error should NOT be transformed (filter excludes it)
      const errorInput = {
        type: "list",
        items: [{ type: "error", message: "oops" }],
      }
      const errorResult = resolve(errorInput, { schema: ListWidget, registry })
      // The error widget won't match any schema due to filter, so it stays as-is
      expect(errorResult.output.items[0]).toEqual({ type: "error", message: "oops" })
    })

    it("should resolve deeply nested dynamic structures", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string().alias(["content"]),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const SectionWidget = z.object({
        type: z.literal("section"),
        title: z.string().alias(["heading"]),
        content: dynamic().array().optional(),
      })

      const PageWidget = z.object({
        type: z.literal("page"),
        sections: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: SectionWidget, meta: { id: "Section" } },
        { schema: PageWidget, meta: { id: "Page" } },
      ])

      const input = {
        type: "page",
        sections: [
          {
            type: "section",
            heading: "Introduction",
            content: ["Welcome to the page", { type: "text", content: "More text here" }],
          },
          {
            type: "section",
            title: "Conclusion",
            content: [{ type: "text", text: "The end" }],
          },
        ],
      }

      const result = resolve(input, { schema: PageWidget, registry })
      expect(result.output).toEqual({
        type: "page",
        sections: [
          {
            type: "section",
            title: "Introduction",
            content: [
              { type: "text", text: "Welcome to the page" },
              { type: "text", text: "More text here" },
            ],
          },
          {
            type: "section",
            title: "Conclusion",
            content: [{ type: "text", text: "The end" }],
          },
        ],
      })
    })

    it("should resolve dynamic() inside alternate schemas", () => {
      // TextWidget with string alternate
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      // IconWidget with simple { icon: string } alternate
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
          size: z.number().optional(),
        })
        .alternate(z.object({ icon: z.string() }), (v) => ({ type: "icon", icon: v.icon }))

      // CardWidget's primary form has explicit header and body
      // The alternate form accepts { title, content } where content is dynamic
      // This tests that dynamic() works inside the alternate's object schema
      const CardWidget = z
        .object({
          type: z.literal("card"),
          header: z.object({
            title: z.string(),
            icon: IconWidget.optional(),
          }),
          body: dynamic().array(),
        })
        .alternate(
          z.object({
            title: z.string(),
            icon: z.string().optional(),
            content: dynamic().array(),
          }),
          (v) => ({
            type: "card",
            header: {
              title: v.title,
              icon: v.icon ? { type: "icon", icon: v.icon } : undefined,
            },
            body: v.content,
          }),
        )

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: IconWidget, meta: { id: "Icon" } },
        { schema: CardWidget, meta: { id: "Card" } },
      ])

      // Use the alternate form with dynamic content
      // The content array should be resolved from the registry
      const input = {
        title: "My Card",
        icon: "star",
        content: ["Plain string becomes text widget", { type: "text", text: "Explicit text widget" }, { type: "icon", icon: "heart", size: 24 }],
      }

      const result = resolve(input, { schema: CardWidget, registry })

      expect(result.output).toEqual({
        type: "card",
        header: {
          title: "My Card",
          icon: { type: "icon", icon: "star" },
        },
        body: [
          { type: "text", text: "Plain string becomes text widget" },
          { type: "text", text: "Explicit text widget" },
          { type: "icon", icon: "heart", size: 24 },
        ],
      })
      expect(result.schema).toBe(CardWidget)
    })

    it("should resolve nested dynamic() with alternates at multiple levels", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      // TabWidget can be written as full form or as { label, content } shorthand
      const TabWidget = z
        .object({
          type: z.literal("tab"),
          label: z.string(),
          content: dynamic().array(),
        })
        .alternate(
          z.object({
            label: z.string(),
            items: dynamic().array().alias(["content", "children"]),
          }),
          (v) => ({ type: "tab", label: v.label, content: v.items }),
        )

      // TabsWidget contains multiple tabs
      const TabsWidget = z.object({
        type: z.literal("tabs"),
        tabs: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: TabWidget, meta: { id: "Tab" } },
        { schema: TabsWidget, meta: { id: "Tabs" } },
      ])

      // Deep nesting: Tabs > Tab (via alternate) > Text (via alternate)
      const input = {
        type: "tabs",
        tabs: [
          {
            label: "First Tab",
            children: ["Tab 1 content", { type: "text", text: "More content" }],
          },
          {
            type: "tab",
            label: "Second Tab",
            content: ["Tab 2 content"],
          },
        ],
      }

      const result = resolve(input, { schema: TabsWidget, registry })

      expect(result.output).toEqual({
        type: "tabs",
        tabs: [
          {
            type: "tab",
            label: "First Tab",
            content: [
              { type: "text", text: "Tab 1 content" },
              { type: "text", text: "More content" },
            ],
          },
          {
            type: "tab",
            label: "Second Tab",
            content: [{ type: "text", text: "Tab 2 content" }],
          },
        ],
      })
    })

    it("should resolve dynamic() field that resolves to a widget with its own dynamic() field", () => {
      // TextWidget - the innermost widget
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string().alias(["content"]),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      // WrapperWidget - has a single dynamic() field (not array)
      const WrapperWidget = z.object({
        type: z.literal("wrapper"),
        child: dynamic(),
      })

      // ContainerWidget - also has a single dynamic() field
      const ContainerWidget = z.object({
        type: z.literal("container"),
        content: dynamic(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: WrapperWidget, meta: { id: "Wrapper" } },
        { schema: ContainerWidget, meta: { id: "Container" } },
      ])

      // Container > Wrapper > Text (3 levels of dynamic resolution)
      const input = {
        type: "container",
        content: {
          type: "wrapper",
          child: {
            type: "text",
            content: "deeply nested",
          },
        },
      }

      const result = resolve(input, { schema: ContainerWidget, registry })

      expect(result.output).toEqual({
        type: "container",
        content: {
          type: "wrapper",
          child: {
            type: "text",
            text: "deeply nested",
          },
        },
      })
      expect(result.schema).toBe(ContainerWidget)
    })

    it("should resolve dynamic() chain with alternates at each level", () => {
      // TextWidget with string alternate
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      // BoxWidget wraps a single dynamic child, with shorthand alternate
      const BoxWidget = z
        .object({
          type: z.literal("box"),
          child: dynamic(),
        })
        .alternate(z.object({ box: dynamic() }), (v) => ({ type: "box", child: v.box }))

      // FrameWidget wraps a single dynamic child, with shorthand alternate
      const FrameWidget = z
        .object({
          type: z.literal("frame"),
          content: dynamic(),
        })
        .alternate(z.object({ frame: dynamic() }), (v) => ({ type: "frame", content: v.frame }))

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: BoxWidget, meta: { id: "Box" } },
        { schema: FrameWidget, meta: { id: "Frame" } },
      ])

      // Use alternates at each level:
      // { frame: { box: "hello" } }
      // → Frame > Box > Text
      const input = {
        frame: {
          box: "hello world",
        },
      }

      const result = resolve(input, { schema: FrameWidget, registry })

      expect(result.output).toEqual({
        type: "frame",
        content: {
          type: "box",
          child: {
            type: "text",
            text: "hello world",
          },
        },
      })
      expect(result.schema).toBe(FrameWidget)
    })

    it("should resolve ListWidget with all alternate forms and aliases", () => {
      // Normalizer that handles flexible type matching (e.g., 'List', 'LIST', 'list-widget' → 'list')
      const widgetTypeNormalizer = (v: string) => v.toLowerCase().replace(/[-_\s]*(widget)?$/i, "")

      // TextWidget for nested dynamic content
      const TextWidget = z
        .object({
          type: z.literal("text").flexible(widgetTypeNormalizer),
          text: z.string().alias(["value", "content"]),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      // IconWidget for nested dynamic content
      const IconWidget = z.object({
        type: z.literal("icon").flexible(widgetTypeNormalizer),
        icon: z.string(),
        size: z.number().optional(),
      })

      // ListWidget with complex alternates and aliases
      const ListWidget = z.object({
        type: z.literal("list").flexible(widgetTypeNormalizer),
        items: z
          .array(
            z
              .object({
                title: z.string().optional().alias(["label", "name"]),
                content: dynamic().array().optional().describe("array of widget objects").alias(["items"]),
              })
              // String alternate: "Hello" → { title: "Hello" }
              .alternate(z.string(), (v) => ({
                title: v,
              }))
              // Dynamic alternate: { type: 'icon', icon: 'star' } → { content: [{ type: 'icon', icon: 'star' }] }
              .alternate(dynamic(), (v) => ({
                content: [v],
              })),
          )
          .alias(["entries"]),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: IconWidget, meta: { id: "Icon" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      // Challenging input using:
      // 1. 'List-Widget' type (flexible normalizer → 'list')
      // 2. 'entries' alias for items
      // 3. String alternate ("First Item" → { title: "First Item" })
      // 4. 'label' alias for title
      // 5. 'name' alias for title with 'items' alias for content
      // 6. Dynamic alternate (IconWidget directly → { content: [IconWidget] })
      // 7. Nested dynamic content with string alternate inside
      const input = {
        type: "List-Widget",
        entries: [
          // Entry 1: String alternate → { title: "First Item" }
          "First Item",

          // Entry 2: Object with 'label' alias for title
          { label: "Second Item" },

          // Entry 3: Object with 'name' alias for title and 'items' alias for content (with nested string alternate)
          {
            name: "Third Item",
            items: ["Nested text", { type: "TEXT", content: "Another nested text" }],
          },

          // Entry 4: Dynamic alternate - IconWidget directly → { content: [IconWidget] }
          { type: "Icon-Widget", icon: "star", size: 24 },

          // Entry 5: Full canonical form with nested dynamic content
          {
            title: "Fifth Item",
            content: [{ type: "icon", icon: "heart" }, "Plain text widget"],
          },

          // Entry 6: Dynamic alternate with TextWidget (via string alternate inside)
          { type: "text-widget", value: "Sixth item as content" },
        ],
      }

      const result = resolve(input, { schema: ListWidget, registry })

      expect(result.output).toEqual({
        type: "list",
        items: [
          // Entry 1: String → { title: "First Item" }
          { title: "First Item" },

          // Entry 2: 'label' → 'title'
          { title: "Second Item" },

          // Entry 3: 'name' → 'title', 'items' → 'content', nested strings → TextWidgets
          {
            title: "Third Item",
            content: [
              { type: "text", text: "Nested text" },
              { type: "text", text: "Another nested text" },
            ],
          },

          // Entry 4: IconWidget → { content: [IconWidget] }
          {
            content: [{ type: "icon", icon: "star", size: 24 }],
          },

          // Entry 5: Canonical form, nested dynamic resolved
          {
            title: "Fifth Item",
            content: [
              { type: "icon", icon: "heart" },
              { type: "text", text: "Plain text widget" },
            ],
          },

          // Entry 6: TextWidget → { content: [TextWidget] }
          {
            content: [{ type: "text", text: "Sixth item as content" }],
          },
        ],
      })
      expect(result.schema).toBe(ListWidget)
    })

    it("should resolve nested dynamic() and consider aliases and alternates", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string().alias(["value", "content"]),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const ListWidget = z.object({
        type: z.literal("list"),
        items: z
          .object({
            title: z.string().alias(["label", "name"]).optional(),
            content: dynamic()
              .array()
              .alternate(dynamic(), (v) => [v])
              .alias(["items", "children"])
              .optional(),
          })
          .alternate(z.string(), (v) => ({ title: v })) // Fix: return single object, not array
          .array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      const list = {
        type: "list",
        items: [
          { title: "Item 1", items: "Content 1" },
          {
            title: "Item 2",
            content: [
              {
                type: "text",
                text: "Content 2",
              },
            ],
          },
          {
            content: "Item 3",
          },
          "Item 4",
        ],
      }

      const result = resolve(list, { schema: dynamic(), registry })

      expect(result.output).toEqual({
        type: "list",
        items: [
          { title: "Item 1", content: [{ type: "text", text: "Content 1" }] },
          { title: "Item 2", content: [{ type: "text", text: "Content 2" }] },
          { content: [{ type: "text", text: "Item 3" }] },
          { title: "Item 4" },
        ],
      })
      expect(result.schema).toBe(ListWidget)
    })

    it("should handle mixed array elements with objects and string alternates", () => {
      const ItemSchema = z
        .object({
          name: z.string(),
          value: z.number().optional(),
        })
        .alternate(z.string(), (v) => ({ name: v }))

      const ContainerSchema = z.object({
        items: ItemSchema.array(),
      })

      const registry = createRegistry([{ schema: ContainerSchema, meta: { id: "Container" } }])

      // Mixed array: objects and strings
      const input = {
        items: [{ name: "First", value: 1 }, "Second", { name: "Third" }, "Fourth", { name: "Fifth", value: 5 }],
      }

      const result = resolve(input, { schema: ContainerSchema, registry })

      expect(result.output).toEqual({
        items: [{ name: "First", value: 1 }, { name: "Second" }, { name: "Third" }, { name: "Fourth" }, { name: "Fifth", value: 5 }],
      })
      expect(result.schema).toBe(ContainerSchema)
    })

    it("should handle arrays with all string alternates", () => {
      const TagSchema = z
        .object({
          label: z.string(),
          color: z.string().optional(),
        })
        .alternate(z.string(), (v) => ({ label: v }))

      const TagListSchema = z.object({
        tags: TagSchema.array(),
      })

      const registry = createRegistry([{ schema: TagListSchema, meta: { id: "TagList" } }])

      // All strings
      const input = {
        tags: ["red", "green", "blue"],
      }

      const result = resolve(input, { schema: TagListSchema, registry })

      expect(result.output).toEqual({
        tags: [{ label: "red" }, { label: "green" }, { label: "blue" }],
      })
      expect(result.schema).toBe(TagListSchema)
    })

    it("should handle arrays with all object primaries (no alternates triggered)", () => {
      const TagSchema = z
        .object({
          label: z.string(),
          color: z.string().optional(),
        })
        .alternate(z.string(), (v) => ({ label: v }))

      const TagListSchema = z.object({
        tags: TagSchema.array(),
      })

      const registry = createRegistry([{ schema: TagListSchema, meta: { id: "TagList" } }])

      // All objects
      const input = {
        tags: [{ label: "red", color: "#ff0000" }, { label: "green" }, { label: "blue", color: "#0000ff" }],
      }

      const result = resolve(input, { schema: TagListSchema, registry })

      expect(result.output).toEqual({
        tags: [{ label: "red", color: "#ff0000" }, { label: "green" }, { label: "blue", color: "#0000ff" }],
      })
      expect(result.schema).toBe(TagListSchema)
    })

    it("should handle deeply nested arrays with alternates", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const SectionSchema = z
        .object({
          title: z.string().optional(),
          items: dynamic().array().optional(),
        })
        .alternate(z.string(), (v) => ({ title: v }))

      const PageSchema = z.object({
        sections: SectionSchema.array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: SectionSchema, meta: { id: "Section" } },
        { schema: PageSchema, meta: { id: "Page" } },
      ])

      const input = {
        sections: [
          "Introduction", // string alternate → { title: 'Introduction' }
          {
            title: "Content",
            items: [
              "Simple text", // resolves to TextWidget via dynamic + alternate
              { type: "text", text: "Complex text" },
            ],
          },
          { items: ["Orphan item"] },
        ],
      }

      const result = resolve(input, { schema: PageSchema, registry })

      expect(result.output).toEqual({
        sections: [
          { title: "Introduction" },
          {
            title: "Content",
            items: [
              { type: "text", text: "Simple text" },
              { type: "text", text: "Complex text" },
            ],
          },
          { items: [{ type: "text", text: "Orphan item" }] },
        ],
      })
      expect(result.schema).toBe(PageSchema)
    })

    it("should handle optionals correctly with aliases and alternates", () => {
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
        })
        .alternate(z.object({ icon: z.string().alias(["supericon"]) }), (v) => ({ type: "icon", icon: v.icon }))

      const HeaderWidget = z
        .object({
          type: z.literal("header"),
          title: z.string(),
          icon: IconWidget.optional(),
        })
        .alternate(z.object({ title: z.string() }), (v) => ({ type: "header", title: v.title }))

      const registry = createRegistry([
        { schema: IconWidget, meta: { id: "Icon" } },
        { schema: HeaderWidget, meta: { id: "Header" } },
      ])

      const header = {
        type: "header",
        title: "Hello, world!",
        icon: {
          supericon: "boat",
        },
      }

      const result = resolve(header, { schema: HeaderWidget, registry })

      expect(result.output).toEqual({
        type: "header",
        title: "Hello, world!",
        icon: { type: "icon", icon: "boat" },
      })
      expect(result.schema).toBe(HeaderWidget)
    })
  })

  describe("progressive mode - __done keys on nested objects", () => {
    it("should set __done on nested objects resolved via alternates", () => {
      const IconWidget = z
        .object({
          type: z.literal("icon"),
          icon: z.string(),
        })
        .alternate(z.object({ icon: z.string().alias(["supericon"]) }), (v) => ({ type: "icon", icon: v.icon }))

      const HeaderWidget = z.object({
        type: z.literal("header"),
        title: z.string(),
        icon: IconWidget.optional(),
      })

      const registry = createRegistry([
        { schema: IconWidget, meta: { id: "Icon" } },
        { schema: HeaderWidget, meta: { id: "Header" } },
      ])

      const header = {
        type: "header",
        title: "Hello, world!",
        icon: { supericon: "boat" },
      }

      const result = resolve(header, { schema: HeaderWidget, registry, progressive: true })

      expect(result.output).toEqual({
        type: "header",
        title: "Hello, world!",
        icon: { type: "icon", icon: "boat", __done: ["type", "icon"], __completed: true },
      })
      expect(result.schema).toBe(HeaderWidget)
    })

    it("should set __done on nested objects resolved via dynamic() in arrays", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const ListWidget = z.object({
        type: z.literal("list"),
        items: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      const list = {
        type: "list",
        items: ["hello", { type: "text", text: "world" }],
      }

      const result = resolve(list, { schema: ListWidget, registry, progressive: true })

      // First item resolved via string alternate
      expect(result.output.items[0]).toEqual({ type: "text", text: "hello", __done: ["type", "text"], __completed: true })
      // Second item resolved via primary schema (should also have __done if it was an object)
      expect(result.output.items[1]).toEqual({ type: "text", text: "world" })
    })

    it("should set __done on deeply nested objects resolved via alternates", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const SectionWidget = z.object({
        type: z.literal("section"),
        title: z.string(),
        content: dynamic().array().optional(),
      })

      const PageWidget = z.object({
        type: z.literal("page"),
        sections: dynamic().array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: SectionWidget, meta: { id: "Section" } },
        { schema: PageWidget, meta: { id: "Page" } },
      ])

      const page = {
        type: "page",
        sections: [
          {
            type: "section",
            title: "Intro",
            content: ["Welcome"], // string alternate → TextWidget
          },
        ],
      }

      const result = resolve(page, { schema: PageWidget, registry, progressive: true })

      // Check the deeply nested TextWidget has __done set
      expect(result.output.sections[0].content[0]).toEqual({
        type: "text",
        text: "Welcome",
        __done: ["type", "text"],
        __completed: true,
      })
    })

    it("should set __done on nested objects resolved via complex alternates with dynamic content", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const ListWidget = z.object({
        type: z.literal("list"),
        items: z
          .object({
            title: z.string().optional(),
            content: dynamic().array().optional(),
          })
          .alternate(z.string(), (v) => ({ title: v }))
          .array(),
      })

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: ListWidget, meta: { id: "List" } },
      ])

      const list = {
        type: "list",
        items: [
          "Simple title", // string alternate
          { title: "Complex", content: ["Nested text"] }, // object with nested dynamic
        ],
      }

      const result = resolve(list, { schema: ListWidget, registry, progressive: true })

      // First item: string alternate → { title: 'Simple title' }
      expect(result.output.items[0]).toEqual({
        title: "Simple title",
        __done: ["title"],
        __completed: true,
      })

      // Second item's nested content: string alternate → TextWidget
      expect(result.output.items[1].content[0]).toEqual({
        type: "text",
        text: "Nested text",
        __done: ["type", "text"],
        __completed: true,
      })
    })

    it("should set __done on nested objects in alternate mapper output with dynamic fields", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      const IconWidget = z.object({
        type: z.literal("icon"),
        icon: z.string(),
      })

      // CardWidget alternate accepts { title, content } and maps it to the primary form
      // The content field is dynamic and should be resolved from registry
      const CardWidget = z
        .object({
          type: z.literal("card"),
          header: z.object({
            title: z.string(),
          }),
          body: dynamic().array(),
        })
        .alternate(
          z.object({
            title: z.string(),
            content: dynamic().array(),
          }),
          (v) => ({
            type: "card",
            header: { title: v.title },
            body: v.content,
          }),
        )

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: IconWidget, meta: { id: "Icon" } },
        { schema: CardWidget, meta: { id: "Card" } },
      ])

      const card = {
        title: "My Card",
        content: ["Some text", { type: "icon", icon: "star" }],
      }

      const result = resolve(card, { schema: CardWidget, registry, progressive: true })

      // The card itself should have __done set
      expect(result.output.__done).toEqual(["type", "header", "body"])
      expect(result.output.__completed).toBe(true)

      // The nested TextWidget (from string alternate) should have __done
      expect(result.output.body[0]).toEqual({
        type: "text",
        text: "Some text",
        __done: ["type", "text"],
        __completed: true,
      })

      // The nested IconWidget (primary match) should NOT have __done added by resolver
      // (it was already an object matching the primary schema)
      expect(result.output.body[1]).toEqual({ type: "icon", icon: "star" })
    })

    it("should recursively set __done on all nested alternate-resolved objects", () => {
      const TextWidget = z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .alternate(z.string(), (v) => ({ type: "text", text: v }))

      // BoxWidget wraps a single dynamic child
      const BoxWidget = z
        .object({
          type: z.literal("box"),
          child: dynamic(),
        })
        .alternate(z.object({ box: dynamic() }), (v) => ({ type: "box", child: v.box }))

      // FrameWidget wraps a single dynamic child
      const FrameWidget = z
        .object({
          type: z.literal("frame"),
          content: dynamic(),
        })
        .alternate(z.object({ frame: dynamic() }), (v) => ({ type: "frame", content: v.frame }))

      const registry = createRegistry([
        { schema: TextWidget, meta: { id: "Text" } },
        { schema: BoxWidget, meta: { id: "Box" } },
        { schema: FrameWidget, meta: { id: "Frame" } },
      ])

      // Use alternates at each level: { frame: { box: "hello" } }
      const input = {
        frame: {
          box: "hello world",
        },
      }

      const result = resolve(input, { schema: FrameWidget, registry, progressive: true })

      // Top level: FrameWidget resolved via alternate
      expect(result.output.__done).toEqual(["type", "content"])
      expect(result.output.__completed).toBe(true)

      // Nested BoxWidget resolved via alternate
      expect(result.output.content.__done).toEqual(["type", "child"])
      expect(result.output.content.__completed).toBe(true)

      // Deeply nested TextWidget resolved via alternate
      expect(result.output.content.child.__done).toEqual(["type", "text"])
      expect(result.output.content.child.__completed).toBe(true)
    })
  })
})
