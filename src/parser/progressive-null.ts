import { ProgressiveValue } from "./progressive-value"

/**
 * Progressive null parser
 * Adapted from apps/os/src/shared/features/progressive-json/progressive-null.ts
 */
export class ProgressiveNull extends ProgressiveValue<null> {
  private buffer: string = ""

  protected initial() {
    return null
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    // Try to match 'null'
    let i = 0

    while (i < chunk.length) {
      const char = chunk[i].toLowerCase()
      this.buffer += char
      i++

      // Check if we have a complete null token
      if (this.buffer === "null") {
        this.partial = null
        this.end(chunk.slice(i))
        break
      }
    }
  }
}
