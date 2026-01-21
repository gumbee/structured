import { ProgressiveValue } from "@/parser/progressive-value"

/**
 * Progressive number parser
 */
export class ProgressiveNumber extends ProgressiveValue<number> {
  private buffer: string = ""

  protected initial() {
    return 0
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    // Find the point where the number ends
    let i = 0

    while (i < chunk.length) {
      const char = chunk[i]!

      if (/[\d.eE+-]/.test(char)) {
        this.buffer += char
        i++
      } else {
        break
      }
    }

    // if we encounter a non matching character and we've started processing the number, we can end the stream since the number is complete
    if (i < chunk.length) {
      this.partial = parseFloat(this.buffer)
      this.end(chunk.slice(i))
    } else {
      this.partial = parseFloat(this.buffer)
    }
  }
}
