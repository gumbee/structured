import { describe, it, expect, beforeEach } from "vitest"
import { z } from "../schema"
import { DescribeRegistry } from "./registry"
import { schemaToTypescript, registryToTypescript } from "./typescript"
import { collectSchemaDependencies } from "./dependencies"

describe("DescribeRegistry", () => {
  let registry: DescribeRegistry

  beforeEach(() => {
    registry = new DescribeRegistry()
  })

  describe("add()", () => {
    it("should add a schema with metadata", () => {
      const schema = z.object({
        type: z.literal("icon"),
        name: z.string(),
      })

      registry.add(schema, { id: "icon", description: "An icon widget" })

      expect(registry.has("icon")).toBe(true)
      expect(registry.size).toBe(1)
    })

    it("should throw if metadata has no id", () => {
      const schema = z.string()

      expect(() => registry.add(schema, { id: "" })).toThrow("Schema metadata must include an id")
    })

    it("should support method chaining", () => {
      const icon = z.object({ type: z.literal("icon") })
      const text = z.object({ type: z.literal("text") })

      const result = registry.add(icon, { id: "icon" }).add(text, { id: "text" })

      expect(result).toBe(registry)
      expect(registry.size).toBe(2)
    })

    it("should register aliases", () => {
      const schema = z.object({ type: z.literal("icon") })

      registry.add(schema, { id: "icon", aliases: ["ico", "symbol"] })

      expect(registry.has("icon")).toBe(true)
      expect(registry.has("ico")).toBe(true)
      expect(registry.has("symbol")).toBe(true)
    })

    it("should work with native Zod types", () => {
      const schema = z.object({
        type: z.literal("button"),
        label: z.string(),
      })

      registry.add(schema, { id: "button" })

      expect(registry.has("button")).toBe(true)
      expect(registry.getSchema("button")).toBe(schema)
    })
  })

  describe("get()", () => {
    it("should return entry by id", () => {
      const schema = z.string()
      registry.add(schema, { id: "text", description: "A text field" })

      const entry = registry.get("text")

      expect(entry).toBeDefined()
      expect(entry?.schema).toBe(schema)
      expect(entry?.meta.id).toBe("text")
      expect(entry?.meta.description).toBe("A text field")
    })

    it("should return entry by alias", () => {
      const schema = z.string()
      registry.add(schema, { id: "text", aliases: ["str"] })

      const entry = registry.get("str")

      expect(entry).toBeDefined()
      expect(entry?.meta.id).toBe("text")
    })

    it("should return undefined for non-existent id", () => {
      expect(registry.get("nonexistent")).toBeUndefined()
    })
  })

  describe("getSchema() / getMeta()", () => {
    it("should return just the schema", () => {
      const schema = z.number()
      registry.add(schema, { id: "num" })

      expect(registry.getSchema("num")).toBe(schema)
    })

    it("should return just the metadata", () => {
      const schema = z.number()
      registry.add(schema, { id: "num", description: "A number" })

      const meta = registry.getMeta("num")
      expect(meta?.id).toBe("num")
      expect(meta?.description).toBe("A number")
    })
  })

  describe("has() / hasSchema()", () => {
    it("should check if id exists", () => {
      const schema = z.boolean()
      registry.add(schema, { id: "bool" })

      expect(registry.has("bool")).toBe(true)
      expect(registry.has("other")).toBe(false)
    })

    it("should check if schema instance exists", () => {
      const schema = z.boolean()
      const other = z.string()
      registry.add(schema, { id: "bool" })

      expect(registry.hasSchema(schema)).toBe(true)
      expect(registry.hasSchema(other)).toBe(false)
    })
  })

  describe("getIdForSchema()", () => {
    it("should return id for registered schema", () => {
      const schema = z.string()
      registry.add(schema, { id: "text" })

      expect(registry.getIdForSchema(schema)).toBe("text")
    })

    it("should return undefined for unregistered schema", () => {
      const schema = z.string()
      expect(registry.getIdForSchema(schema)).toBeUndefined()
    })
  })

  describe("remove()", () => {
    it("should remove schema by id", () => {
      const schema = z.string()
      registry.add(schema, { id: "text" })

      const removed = registry.remove("text")

      expect(removed).toBe(true)
      expect(registry.has("text")).toBe(false)
      expect(registry.size).toBe(0)
    })

    it("should remove aliases when removing schema", () => {
      const schema = z.string()
      registry.add(schema, { id: "text", aliases: ["str"] })

      registry.remove("text")

      expect(registry.has("text")).toBe(false)
      expect(registry.has("str")).toBe(false)
    })

    it("should return false for non-existent id", () => {
      expect(registry.remove("nonexistent")).toBe(false)
    })
  })

  describe("iterators", () => {
    beforeEach(() => {
      registry.add(z.object({ type: z.literal("icon") }), { id: "icon" })
      registry.add(z.object({ type: z.literal("text") }), { id: "text", aliases: ["txt"] })
    })

    it("values() should yield unique entries", () => {
      const entries = Array.from(registry.values())

      expect(entries).toHaveLength(2)
      expect(entries.map((e) => e.meta.id)).toEqual(["icon", "text"])
    })

    it("entries() should yield [id, entry] pairs", () => {
      const pairs = Array.from(registry.entries())

      expect(pairs).toHaveLength(2)
      expect(pairs.map(([id]) => id)).toEqual(["icon", "text"])
    })

    it("ids() should yield unique ids", () => {
      const ids = Array.from(registry.ids())

      expect(ids).toHaveLength(2)
      expect(ids).toEqual(["icon", "text"])
    })
  })

  describe("clear()", () => {
    it("should remove all schemas", () => {
      registry.add(z.string(), { id: "text" })
      registry.add(z.number(), { id: "num" })

      registry.clear()

      expect(registry.size).toBe(0)
      expect(registry.has("text")).toBe(false)
      expect(registry.has("num")).toBe(false)
    })
  })

  describe("subset()", () => {
    it("should create registry with only specified schemas", () => {
      const icon = z.object({ type: z.literal("icon") })
      const text = z.object({ type: z.literal("text") })
      const button = z.object({ type: z.literal("button") })

      registry.add(icon, { id: "icon" })
      registry.add(text, { id: "text" })
      registry.add(button, { id: "button" })

      const subset = registry.subset(["icon", "text"])

      expect(subset.size).toBe(2)
      expect(subset.has("icon")).toBe(true)
      expect(subset.has("text")).toBe(true)
      expect(subset.has("button")).toBe(false)
    })
  })
})

describe("schemaToTypescript", () => {
  let registry: DescribeRegistry

  beforeEach(() => {
    registry = new DescribeRegistry()
  })

  it("should convert string schema", () => {
    const schema = z.string()
    registry.add(schema, { id: "text" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("string")
  })

  it("should convert number schema", () => {
    const schema = z.number()
    registry.add(schema, { id: "num" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("number")
  })

  it("should convert boolean schema", () => {
    const schema = z.boolean()
    registry.add(schema, { id: "bool" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("boolean")
  })

  it("should convert literal schema", () => {
    const schema = z.literal("icon")
    registry.add(schema, { id: "iconType" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe('"icon"')
  })

  it("should convert enum schema", () => {
    const schema = z.enum(["small", "medium", "large"])
    registry.add(schema, { id: "size" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe('"small" | "medium" | "large"')
  })

  it("should convert array schema", () => {
    const schema = z.array(z.string())
    registry.add(schema, { id: "strings" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("(string)[]")
  })

  it("should convert optional schema", () => {
    const schema = z.string().optional()
    registry.add(schema, { id: "optText" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("string | undefined")
  })

  it("should convert nullable schema", () => {
    const schema = z.string().nullable()
    registry.add(schema, { id: "nullText" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("string | null")
  })

  it("should convert object schema", () => {
    const schema = z.object({
      type: z.literal("icon"),
      name: z.string(),
    })
    registry.add(schema, { id: "icon" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe(`{
  type: "icon"
  name: string
}`)
  })

  it("should convert union schema", () => {
    const schema = z.union([z.string(), z.number()])
    registry.add(schema, { id: "strOrNum" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe("string | number")
  })

  it("should reference registered schemas by type name", () => {
    const icon = z.object({
      type: z.literal("icon"),
      name: z.string(),
    })
    const container = z.object({
      items: z.array(icon),
    })

    registry.add(icon, { id: "icon" })
    registry.add(container, { id: "container" })

    const ts = schemaToTypescript(registry, container)
    expect(ts).toBe(`{
  items: (Icon)[]
}`)
  })

  it("should work with native Zod types", () => {
    const schema = z.object({
      id: z.number(),
      name: z.string(),
    })
    registry.add(schema, { id: "user" })

    const ts = schemaToTypescript(registry, schema)
    expect(ts).toBe(`{
  id: number
  name: string
}`)
  })
})

describe("registryToTypescript", () => {
  let registry: DescribeRegistry

  beforeEach(() => {
    registry = new DescribeRegistry()
  })

  it("should convert all schemas to type definitions", () => {
    registry.add(z.object({ type: z.literal("icon"), name: z.string() }), { id: "icon" })
    registry.add(z.object({ type: z.literal("text"), content: z.string() }), { id: "text" })

    const ts = registryToTypescript(registry)

    expect(ts).toBe(`type Icon = {
  type: "icon"
  name: string
}

type Text = {
  type: "text"
  content: string
}

`)
  })

  it("should include description as JSDoc", () => {
    registry.add(z.string(), { id: "label", description: "A text label" })

    const ts = registryToTypescript(registry)

    expect(ts).toBe(`/**
 * A text label
 */
type Label = string

`)
  })

  it("should include rules as JSDoc", () => {
    registry.add(z.string(), { id: "code", rules: "Must be alphanumeric" })

    const ts = registryToTypescript(registry)

    expect(ts).toBe(`/**
 * Rules: Must be alphanumeric
 */
type Code = string

`)
  })

  it("should include both description and rules in JSDoc", () => {
    registry.add(z.string(), { id: "code", description: "A code identifier", rules: "Must be alphanumeric" })

    const ts = registryToTypescript(registry)

    expect(ts).toBe(`/**
 * A code identifier
 * Rules: Must be alphanumeric
 */
type Code = string

`)
  })

  it("should convert PascalCase type names", () => {
    registry.add(z.string(), { id: "my-widget" })
    registry.add(z.number(), { id: "another_widget" })

    const ts = registryToTypescript(registry)

    expect(ts).toBe(`type MyWidget = string

type AnotherWidget = number

`)
  })

  it("should generate complete type definitions with nested objects", () => {
    const icon = z.object({
      type: z.literal("icon"),
      name: z.string(),
      size: z.number().optional(),
    })

    const button = z.object({
      type: z.literal("button"),
      label: z.string(),
      icon: icon.optional(),
    })

    registry.add(icon, { id: "icon", description: "An icon component" })
    registry.add(button, { id: "button", description: "A button with optional icon" })

    const ts = registryToTypescript(registry)

    expect(ts).toBe(`/**
 * An icon component
 */
type Icon = {
  type: "icon"
  name: string
  size: number | undefined
}

/**
 * A button with optional icon
 */
type Button = {
  type: "button"
  label: string
  icon: Icon | undefined
}

`)
  })
})

describe("collectSchemaDependencies", () => {
  let registry: DescribeRegistry

  beforeEach(() => {
    registry = new DescribeRegistry()
  })

  it("should collect direct dependencies", () => {
    const icon = z.object({ type: z.literal("icon"), name: z.string() })
    const container = z.object({ icon: icon })

    registry.add(icon, { id: "icon" })
    registry.add(container, { id: "container" })

    const deps = collectSchemaDependencies(["container"], registry)

    expect(deps).toContain("container")
    expect(deps).toContain("icon")
  })

  it("should collect array element dependencies", () => {
    const item = z.object({ type: z.literal("item") })
    const list = z.object({ items: z.array(item) })

    registry.add(item, { id: "item" })
    registry.add(list, { id: "list" })

    const deps = collectSchemaDependencies(["list"], registry)

    expect(deps).toContain("list")
    expect(deps).toContain("item")
  })

  it("should collect union type dependencies", () => {
    const icon = z.object({ type: z.literal("icon") })
    const text = z.object({ type: z.literal("text") })
    const widget = z.union([icon, text])

    registry.add(icon, { id: "icon" })
    registry.add(text, { id: "text" })
    registry.add(widget, { id: "widget" })

    const deps = collectSchemaDependencies(["widget"], registry)

    expect(deps).toContain("widget")
    expect(deps).toContain("icon")
    expect(deps).toContain("text")
  })

  it("should collect explicit metadata dependencies", () => {
    const base = z.object({ id: z.string() })
    const derived = z.object({ name: z.string() })

    registry.add(base, { id: "base" })
    registry.add(derived, { id: "derived", dependencies: ["base"] })

    const deps = collectSchemaDependencies(["derived"], registry)

    expect(deps).toContain("derived")
    expect(deps).toContain("base")
  })

  it("should include always schemas", () => {
    const icon = z.object({ type: z.literal("icon") })
    const common = z.object({ type: z.literal("common") })

    registry.add(icon, { id: "icon" })
    registry.add(common, { id: "common", always: true })

    const deps = collectSchemaDependencies(["icon"], registry)

    expect(deps).toContain("icon")
    expect(deps).toContain("common")
  })

  it("should resolve schema by alias", () => {
    const widget = z.object({ type: z.literal("widget") })

    registry.add(widget, { id: "widget", aliases: ["component"] })

    const deps = collectSchemaDependencies(["component"], registry)

    expect(deps).toContain("widget")
  })

  it("should not include unregistered schemas", () => {
    const deps = collectSchemaDependencies(["nonexistent"], registry)

    expect(deps).toHaveLength(0)
  })

  it("should handle deeply nested dependencies", () => {
    const leaf = z.object({ type: z.literal("leaf") })
    const branch = z.object({ leaf: leaf })
    const tree = z.object({ branches: z.array(branch) })

    registry.add(leaf, { id: "leaf" })
    registry.add(branch, { id: "branch" })
    registry.add(tree, { id: "tree" })

    const deps = collectSchemaDependencies(["tree"], registry)

    expect(deps).toContain("tree")
    expect(deps).toContain("branch")
    expect(deps).toContain("leaf")
  })
})

describe("Integration", () => {
  it("should work end-to-end: register, collect deps, generate TypeScript", () => {
    const registry = new DescribeRegistry()

    // Define schemas
    const Icon = z.object({
      type: z.literal("icon"),
      name: z.string(),
      size: z.enum(["small", "medium", "large"]).optional(),
    })

    const Text = z.object({
      type: z.literal("text"),
      content: z.string(),
    })

    const Card = z.object({
      type: z.literal("card"),
      icon: Icon.optional(),
      title: Text,
    })

    // Register schemas
    registry
      .add(Icon, { id: "icon", description: "An icon component" })
      .add(Text, { id: "text", description: "A text component" })
      .add(Card, { id: "card", description: "A card with icon and title" })

    // Collect dependencies for Card
    const deps = registry.collectDependencies(["card"])
    expect(deps).toContain("card")
    expect(deps).toContain("icon")
    expect(deps).toContain("text")

    // Create subset with dependencies
    const subset = registry.subset(["card"])
    expect(subset.size).toBe(3)

    // Generate TypeScript
    const typescript = subset.toTypescript()

    // Verify each type definition is complete (order may vary in subset)
    expect(typescript).toContain(`/**
 * An icon component
 */
type Icon = {
  type: "icon"
  name: string
  size: "small" | "medium" | "large" | undefined
}`)

    expect(typescript).toContain(`/**
 * A text component
 */
type Text = {
  type: "text"
  content: string
}`)

    expect(typescript).toContain(`/**
 * A card with icon and title
 */
type Card = {
  type: "card"
  icon: Icon | undefined
  title: Text
}`)
  })

  it("should handle complex nested structures with arrays and unions", () => {
    const registry = new DescribeRegistry()

    const Badge = z.object({
      type: z.literal("badge"),
      label: z.string(),
      color: z.enum(["red", "green", "blue"]),
    })

    const Avatar = z.object({
      type: z.literal("avatar"),
      src: z.string(),
      alt: z.string().optional(),
    })

    const ListItem = z.object({
      type: z.literal("list-item"),
      content: z.string(),
      badges: z.array(Badge),
      avatar: Avatar.optional(),
    })

    const List = z.object({
      type: z.literal("list"),
      items: z.array(ListItem),
      title: z.string().optional(),
    })

    registry.add(Badge, { id: "badge" }).add(Avatar, { id: "avatar" }).add(ListItem, { id: "list-item" }).add(List, { id: "list" })

    // Verify dependencies are collected correctly
    const deps = registry.collectDependencies(["list"])
    expect(deps).toEqual(expect.arrayContaining(["list", "list-item", "badge", "avatar"]))

    // Verify full TypeScript output
    const typescript = registry.toTypescript()

    expect(typescript).toBe(`type Badge = {
  type: "badge"
  label: string
  color: "red" | "green" | "blue"
}

type Avatar = {
  type: "avatar"
  src: string
  alt: string | undefined
}

type ListItem = {
  type: "list-item"
  content: string
  badges: (Badge)[]
  avatar: Avatar | undefined
}

type List = {
  type: "list"
  items: (ListItem)[]
  title: string | undefined
}

`)
  })
})
