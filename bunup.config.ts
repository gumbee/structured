import { defineConfig } from "bunup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/describe.ts",
    "src/schema-entry.ts",
    "src/parser-entry.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  minify: true,
  splitting: true,
})
