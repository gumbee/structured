import { ProgressiveValue } from "./progressive-value"

/**
 * Progressive undefined parser
 * LLMs sometimes output `undefined` which is not valid JSON. We still handle it though.
 */
export class ProgressiveUndefined extends ProgressiveValue<undefined> {
  private buffer: string = ""

  protected initial() {
    return undefined
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    // Try to match 'undefined'
    let i = 0

    while (i < chunk.length) {
      const char = chunk[i].toLowerCase()
      this.buffer += char
      i++

      // Check if we have a complete undefined token
      if (this.buffer === "undefined") {
        this.partial = undefined
        this.end(chunk.slice(i))
        break
      }
    }
  }
}
