import { defineConfig } from "bunup"

export default defineConfig({
  entry: ["src/index.ts", "src/describe/index.ts", "src/schema/index.ts", "src/parser/index.ts", "src/queries.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  minify: true,
  splitting: true,
})
