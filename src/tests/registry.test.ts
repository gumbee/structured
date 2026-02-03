import { describe, it, expect, beforeEach } from "vitest"
import { z } from "@/schema"
import { DescribeRegistry } from "@/describe/registry"
import { schemaToTypescript, registryToTypescript } from "@/describe/typescript"
import { collectSchemaDependencies } from "@/describe/dependencies"

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

  it("should convert string schema with default type name", () => {
    const schema = z.string()

    const ts = schemaToTypescript(schema)

    // Structural assertions
    expect(ts).toContain("type Output =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(1)

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should convert string schema with custom type name", () => {
    const schema = z.string()

    const ts = schemaToTypescript(schema, undefined, "CustomName")

    // Structural assertions
    expect(ts).toContain("type CustomName =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(1)

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should convert number schema", () => {
    const schema = z.number()

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert boolean schema", () => {
    const schema = z.boolean()

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert literal schema", () => {
    const schema = z.literal("icon")

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert enum schema", () => {
    const schema = z.enum(["small", "medium", "large"])

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert array schema", () => {
    const schema = z.array(z.string())

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert optional schema", () => {
    const schema = z.string().optional()

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert nullable schema", () => {
    const schema = z.string().nullable()

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should convert object schema", () => {
    const schema = z.object({
      type: z.literal("icon"),
      name: z.string(),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should include field descriptions as inline comments", () => {
    const schema = z.object({
      home: z.string().describe("The home of the user"),
      age: z.number().describe("The age in years"),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toContain("// The home of the user")
    expect(ts).toContain("// The age in years")
    expect(ts).toMatchSnapshot()
  })

  it("should include field descriptions when wrapped with optional", () => {
    const schema = z.object({
      nickname: z.string().describe("An optional nickname").optional(),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("// An optional nickname")
    expect(ts).toMatchSnapshot()
  })

  it("should include field descriptions when wrapped with nullable", () => {
    const schema = z.object({
      middleName: z.string().describe("Middle name if any").nullable(),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("// Middle name if any")
    expect(ts).toMatchSnapshot()
  })

  it("should include field descriptions when describe is called on optional", () => {
    const schema = z.object({
      bio: z.string().optional().describe("A short biography"),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("// A short biography")
    expect(ts).toMatchSnapshot()
  })

  it("should handle mixed fields with and without descriptions", () => {
    const schema = z.object({
      id: z.number(),
      name: z.string().describe("The user's full name"),
      email: z.string(),
      phone: z.string().describe("Contact phone number").optional(),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("id: number")
    expect(ts).not.toMatch(/id: number\s*\/\//)
    expect(ts).toContain("// The user's full name")
    expect(ts).toContain("email: string")
    expect(ts).not.toMatch(/email: string\s*\/\//)
    expect(ts).toContain("// Contact phone number")
    expect(ts).toMatchSnapshot()
  })

  it("should include field descriptions in nested objects", () => {
    const schema = z.object({
      user: z.object({
        name: z.string().describe("User's name"),
        settings: z.object({
          theme: z.string().describe("UI theme preference"),
        }),
      }),
    })

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("// User's name")
    expect(ts).toContain("// UI theme preference")
    expect(ts).toMatchSnapshot()
  })

  it("should convert union schema", () => {
    const schema = z.union([z.string(), z.number()])

    const ts = schemaToTypescript(schema)

    expect(ts).toContain("type Output =")
    expect(ts).toMatchSnapshot()
  })

  it("should include referenced registry types as standalone types", () => {
    const icon = z.object({
      type: z.literal("icon"),
      name: z.string(),
    })
    const container = z.object({
      items: z.array(icon),
    })

    registry.add(icon, { id: "icon", description: "An icon component" })
    registry.add(container, { id: "container" })

    const ts = schemaToTypescript(container, registry, "Container")

    // Structural assertions - verify both types are present
    expect(ts).toContain("type Icon =")
    expect(ts).toContain("type Container =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(2)

    // Verify JSDoc is included for referenced type
    expect(ts).toContain("/**")
    expect(ts).toContain("An icon component")

    // Verify Icon is defined before Container (dependency first)
    const iconPos = ts.indexOf("type Icon =")
    const containerPos = ts.indexOf("type Container =")
    expect(iconPos).toBeLessThan(containerPos)

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should include JSDoc from registry metadata", () => {
    const schema = z.object({
      id: z.number(),
      name: z.string(),
    })
    registry.add(schema, { id: "user", description: "A user object", rules: "Name must be unique" })

    const ts = schemaToTypescript(schema, registry, "User")

    // Structural assertions
    expect(ts).toContain("type User =")
    expect(ts).toContain("/**")
    expect(ts).toContain("A user object")
    expect(ts).toContain("Rules: Name must be unique")

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should handle deeply nested dependencies", () => {
    const leaf = z.object({ type: z.literal("leaf"), value: z.string() })
    const branch = z.object({ type: z.literal("branch"), leaf: leaf })
    const tree = z.object({ type: z.literal("tree"), branches: z.array(branch) })

    registry.add(leaf, { id: "leaf" })
    registry.add(branch, { id: "branch" })
    registry.add(tree, { id: "tree" })

    const ts = schemaToTypescript(tree, registry, "Tree")

    // Structural assertions - all three types present
    expect(ts).toContain("type Leaf =")
    expect(ts).toContain("type Branch =")
    expect(ts).toContain("type Tree =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(3)

    // Verify order: dependencies before dependents
    const leafPos = ts.indexOf("type Leaf =")
    const branchPos = ts.indexOf("type Branch =")
    const treePos = ts.indexOf("type Tree =")
    expect(leafPos).toBeLessThan(branchPos)
    expect(branchPos).toBeLessThan(treePos)

    // Snapshot
    expect(ts).toMatchSnapshot()
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

    // Structural assertions
    expect(ts).toContain("type Icon =")
    expect(ts).toContain("type Text =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(2)

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should include description as JSDoc", () => {
    registry.add(z.string(), { id: "label", description: "A text label" })

    const ts = registryToTypescript(registry)

    // Structural assertions
    expect(ts).toContain("type Label =")
    expect(ts).toContain("/**")
    expect(ts).toContain("A text label")

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should include rules as JSDoc", () => {
    registry.add(z.string(), { id: "code", rules: "Must be alphanumeric" })

    const ts = registryToTypescript(registry)

    // Structural assertions
    expect(ts).toContain("type Code =")
    expect(ts).toContain("Rules: Must be alphanumeric")

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should include both description and rules in JSDoc", () => {
    registry.add(z.string(), { id: "code", description: "A code identifier", rules: "Must be alphanumeric" })

    const ts = registryToTypescript(registry)

    // Structural assertions
    expect(ts).toContain("A code identifier")
    expect(ts).toContain("Rules: Must be alphanumeric")

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should convert PascalCase type names", () => {
    registry.add(z.string(), { id: "my-widget" })
    registry.add(z.number(), { id: "another_widget" })

    const ts = registryToTypescript(registry)

    // Structural assertions
    expect(ts).toContain("type MyWidget =")
    expect(ts).toContain("type AnotherWidget =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(2)

    // Snapshot
    expect(ts).toMatchSnapshot()
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

    // Structural assertions
    expect(ts).toContain("type Icon =")
    expect(ts).toContain("type Button =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(2)
    expect(ts).toContain("An icon component")
    expect(ts).toContain("A button with optional icon")

    // Snapshot
    expect(ts).toMatchSnapshot()
  })

  it("should not duplicate types when dependencies are referenced multiple times", () => {
    const shared = z.object({ type: z.literal("shared"), id: z.string() })
    const a = z.object({ type: z.literal("a"), shared: shared })
    const b = z.object({ type: z.literal("b"), shared: shared })

    registry.add(shared, { id: "shared" })
    registry.add(a, { id: "a" })
    registry.add(b, { id: "b" })

    const ts = registryToTypescript(registry)

    // Structural assertions - each type should appear exactly once
    expect(ts.match(/type Shared =/g)).toHaveLength(1)
    expect(ts.match(/type A =/g)).toHaveLength(1)
    expect(ts.match(/type B =/g)).toHaveLength(1)
    expect(ts.match(/type \w+ =/g)).toHaveLength(3)

    // Snapshot
    expect(ts).toMatchSnapshot()
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

    // Structural assertions
    expect(typescript).toContain("type Icon =")
    expect(typescript).toContain("type Text =")
    expect(typescript).toContain("type Card =")
    expect(typescript.match(/type \w+ =/g)).toHaveLength(3)
    expect(typescript).toContain("An icon component")
    expect(typescript).toContain("A text component")
    expect(typescript).toContain("A card with icon and title")

    // Snapshot
    expect(typescript).toMatchSnapshot()
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

    // Structural assertions
    expect(typescript).toContain("type Badge =")
    expect(typescript).toContain("type Avatar =")
    expect(typescript).toContain("type ListItem =")
    expect(typescript).toContain("type List =")
    expect(typescript.match(/type \w+ =/g)).toHaveLength(4)

    // Snapshot
    expect(typescript).toMatchSnapshot()
  })

  it("should use schemaToTypescript with custom type name for single schema output", () => {
    const registry = new DescribeRegistry()

    const Icon = z.object({
      type: z.literal("icon"),
      name: z.string(),
    })

    const Button = z.object({
      type: z.literal("button"),
      label: z.string(),
      icon: Icon.optional(),
    })

    registry.add(Icon, { id: "icon", description: "An icon" })
    registry.add(Button, { id: "button", description: "A button" })

    // Use schemaToTypescript to get just Button and its deps with custom name
    const ts = schemaToTypescript(Button, registry, "MyButton")

    // Structural assertions
    expect(ts).toContain("type Icon =")
    expect(ts).toContain("type MyButton =")
    expect(ts.match(/type \w+ =/g)).toHaveLength(2)

    // Snapshot
    expect(ts).toMatchSnapshot()
  })
})

describe("Utility Schemas", () => {
  let registry: DescribeRegistry

  beforeEach(() => {
    registry = new DescribeRegistry()
  })

  describe("registryToTypescript", () => {
    it("should render utility schemas as named types, not inlined", () => {
      const Color = z.object({
        r: z.number(),
        g: z.number(),
        b: z.number(),
      })

      const Button = z.object({
        type: z.literal("button"),
        label: z.string(),
        color: Color,
      })

      registry.add(Color, { id: "color", utility: true })
      registry.add(Button, { id: "button" })

      const ts = registryToTypescript(registry)

      // Utility schema should be defined as a named type
      expect(ts).toContain("type Color =")

      // Button should reference Color by name, not inline it
      expect(ts).toContain("color: Color")
      expect(ts).not.toMatch(/color: \{/)

      // Snapshot
      expect(ts).toMatchSnapshot()
    })

    it("should separate utility schemas into a dedicated section with headers", () => {
      const Size = z.enum(["small", "medium", "large"])
      const Icon = z.object({
        type: z.literal("icon"),
        name: z.string(),
        size: Size,
      })

      registry.add(Size, { id: "size", utility: true, description: "Size options" })
      registry.add(Icon, { id: "icon", description: "An icon component" })

      const ts = registryToTypescript(registry)

      // Should have section headers
      expect(ts).toContain("// --- Main Types ---")
      expect(ts).toContain("// --- Utility Types ---")

      // Utility types should come before main types section
      const mainTypesPos = ts.indexOf("// --- Main Types ---")
      const utilityTypesPos = ts.indexOf("// --- Utility Types ---")
      expect(utilityTypesPos).toBeLessThan(mainTypesPos)

      // Size should be in utility section (after utility header, before main header)
      const sizePos = ts.indexOf("type Size =")
      expect(sizePos).toBeGreaterThan(utilityTypesPos)
      expect(sizePos).toBeLessThan(mainTypesPos)

      // Icon should be in main section (after main header)
      const iconPos = ts.indexOf("type Icon =")
      expect(iconPos).toBeGreaterThan(mainTypesPos)

      // Snapshot
      expect(ts).toMatchSnapshot()
    })

    it("should allow utility schema to be referenced from multiple schemas", () => {
      const Dimensions = z.object({
        width: z.number(),
        height: z.number(),
      })

      const Image = z.object({
        type: z.literal("image"),
        src: z.string(),
        dimensions: Dimensions,
      })

      const Video = z.object({
        type: z.literal("video"),
        src: z.string(),
        dimensions: Dimensions,
      })

      registry.add(Dimensions, { id: "dimensions", utility: true })
      registry.add(Image, { id: "image" })
      registry.add(Video, { id: "video" })

      const ts = registryToTypescript(registry)

      // Dimensions should be defined exactly once
      expect(ts.match(/type Dimensions =/g)).toHaveLength(1)

      // Both Image and Video should reference Dimensions by name
      expect(ts).toMatch(/dimensions: Dimensions/)

      // Count references - should appear in both Image and Video
      const dimensionsRefs = ts.match(/dimensions: Dimensions/g)
      expect(dimensionsRefs).toHaveLength(2)

      // Snapshot
      expect(ts).toMatchSnapshot()
    })

    it("should not show section headers when there are no utility schemas", () => {
      const Icon = z.object({ type: z.literal("icon"), name: z.string() })
      const Text = z.object({ type: z.literal("text"), content: z.string() })

      registry.add(Icon, { id: "icon" })
      registry.add(Text, { id: "text" })

      const ts = registryToTypescript(registry)

      // Should not have section headers when no utility schemas
      expect(ts).not.toContain("// ---")

      // Snapshot
      expect(ts).toMatchSnapshot()
    })

    it("should not show section headers when there are only utility schemas", () => {
      const Color = z.object({ r: z.number(), g: z.number(), b: z.number() })
      const Size = z.enum(["small", "medium", "large"])

      registry.add(Color, { id: "color", utility: true })
      registry.add(Size, { id: "size", utility: true })

      const ts = registryToTypescript(registry)

      // Should not have section headers when only utility schemas
      expect(ts).not.toContain("// ---")

      // Snapshot
      expect(ts).toMatchSnapshot()
    })
  })

  describe("schemaToTypescript", () => {
    it("should include utility schema dependencies in a separate section", () => {
      const Color = z.object({
        r: z.number(),
        g: z.number(),
        b: z.number(),
      })

      const Button = z.object({
        type: z.literal("button"),
        label: z.string(),
        backgroundColor: Color,
      })

      registry.add(Color, { id: "color", utility: true, description: "RGB color" })
      registry.add(Button, { id: "button", description: "A button component" })

      const ts = schemaToTypescript(Button, registry, "Button")

      // Both types should be present
      expect(ts).toContain("type Button =")
      expect(ts).toContain("type Color =")

      // Should have section headers
      expect(ts).toContain("// --- Main Types ---")
      expect(ts).toContain("// --- Utility Types ---")

      // Button should reference Color by name
      expect(ts).toContain("backgroundColor: Color")

      // Snapshot
      expect(ts).toMatchSnapshot()
    })

    it("should handle nested utility schema dependencies", () => {
      const Color = z.object({ r: z.number(), g: z.number(), b: z.number() })
      const Border = z.object({ width: z.number(), color: Color })
      const Card = z.object({
        type: z.literal("card"),
        title: z.string(),
        border: Border,
      })

      registry.add(Color, { id: "color", utility: true })
      registry.add(Border, { id: "border", utility: true })
      registry.add(Card, { id: "card" })

      const ts = schemaToTypescript(Card, registry, "Card")

      // All types should be present
      expect(ts).toContain("type Card =")
      expect(ts).toContain("type Border =")
      expect(ts).toContain("type Color =")

      // Utility types should come before main types
      const utilityPos = ts.indexOf("// --- Utility Types ---")
      const mainPos = ts.indexOf("// --- Main Types ---")
      const colorPos = ts.indexOf("type Color =")
      const borderPos = ts.indexOf("type Border =")
      const cardPos = ts.indexOf("type Card =")

      // Utility section comes first
      expect(utilityPos).toBeLessThan(mainPos)

      // Both utility types should be in utility section (before main)
      expect(colorPos).toBeGreaterThan(utilityPos)
      expect(colorPos).toBeLessThan(mainPos)
      expect(borderPos).toBeGreaterThan(utilityPos)
      expect(borderPos).toBeLessThan(mainPos)

      // Card should be in main section
      expect(cardPos).toBeGreaterThan(mainPos)

      // Snapshot
      expect(ts).toMatchSnapshot()
    })
  })
})
