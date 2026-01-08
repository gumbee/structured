import { ProgressiveValue } from "./progressive-value"
import { type StructuredParseOptions } from "./types"

/**
 * Progressive string parser that handles escape sequences
 * Adapted from apps/os/src/shared/features/progressive-json/progressive-string.ts
 */
export class ProgressiveString extends ProgressiveValue<string> {
  quote: string = ""
  private escaped: boolean = false

  constructor(quote: string, options: StructuredParseOptions) {
    super(options)
    this.quote = quote
  }

  protected initial() {
    return ""
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    // Process the string character by character
    let i = 0

    while (i < chunk.length) {
      const char = chunk[i]

      // Handle escape sequences
      if (this.escaped) {
        if (char === this.quote) {
          this.partial += char
        } else {
          // handle escape sequences
          switch (char) {
            case "n":
              this.partial += "\n"
              break
            case "t":
              this.partial += "\t"
              break
            case "r":
              this.partial += "\r"
              break
            case "b":
              this.partial += "\b"
              break
            case "f":
              this.partial += "\f"
              break
            case "\\":
              this.partial += "\\"
              break
            case "/":
              this.partial += "/"
              break
            case "u":
              // Unicode escape sequences would need more characters
              // This is a simplified version that would need to be expanded
              this.partial += "\\u"
              break
            default:
              this.partial += char
          }
        }

        this.escaped = false
        i++
        continue
      }

      if (char === "\\") {
        this.escaped = true
        i++
        continue
      }

      // Check for closing quote
      if (char === this.quote) {
        // String is complete, end the stream
        this.end(chunk.slice(i + 1))
        return
      }

      // Add character to buffer
      this.partial += char
      i++
    }
  }
}
