import { ProgressiveValue } from "@/parser/progressive-value"

/**
 * Progressive boolean parser
 */
export class ProgressiveBoolean extends ProgressiveValue<boolean> {
  private buffer: string = ""

  protected initial() {
    return false
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    // Try to match 'true' or 'false'
    let i = 0

    while (i < chunk.length) {
      const char = chunk[i]!.toLowerCase()
      this.buffer += char
      i++

      // Check if we have a complete boolean token
      if (this.buffer === "true") {
        this.partial = true
        this.end(chunk.slice(i))
        break
      } else if (this.buffer === "false") {
        this.partial = false
        this.end(chunk.slice(i))
        break
      }
    }
  }
}
