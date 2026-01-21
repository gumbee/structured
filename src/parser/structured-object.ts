import { ProgressiveValue } from "@/parser/progressive-value"
import { makeStructuredParser } from "@/parser/factory"
import { ProgressiveString } from "@/parser/progressive-string"
import type { Progressive, StructuredParseOptions } from "@/parser/types"

/**
 * Schema-aware progressive object parser
 *
 * Note: Alias resolution is NOT done during parsing. Keys are parsed as-is.
 * Alias resolution happens during the validation/transformation phase (in resolver/alternate.ts)
 * only when the overall schema matches (excluding aliased fields).
 */
export class StructuredObject extends ProgressiveValue<Progressive<Record<string, any>>> {
  private state: "key" | "value" | "colon" | "comma" = "key"
  private keyStream: ProgressiveValue | null = null
  private valueStream: ProgressiveValue | null = null
  private currentKey: string = ""
  private buffer: string = ""
  private quote: string = ""

  constructor(options: StructuredParseOptions) {
    super(options)

    this.partial.__done = [] as string[]
    this.partial.__completed = false
  }

  protected initial() {
    return {}
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    if (!this.keyStream && !this.valueStream) {
      if (chunk.startsWith("}")) {
        this.partial.__completed = true
        this.end(chunk.slice(1))
        return
      }
    }

    // Process the object based on current state
    if (this.state === "key") {
      if (this.keyStream) {
        this.keyStream.process(chunk)
      } else {
        this.buffer += chunk
        const [s, r] = makeStructuredParser(this.buffer, {
          ...this.options,
          onComplete: (key: any, remainder: string) => {
            // Store key as-is - alias resolution happens during validation, not parsing
            this.currentKey = String(key).trim()

            this.keyStream = null
            this.state = "colon"
            this.process(remainder)
          },
        })

        this.keyStream = s

        if (s) {
          // remember which quote was used to start the string
          if (s instanceof ProgressiveString) this.quote = s.quote

          this.buffer = ""
          s.process(r)
        }
      }
    } else if (this.state === "colon") {
      // Look for colon separator
      const colonIndex = chunk.indexOf(":")
      if (colonIndex >= 0) {
        this.state = "value"
        // Use trimStart() not trim() - trailing whitespace could be part of an incomplete string value
        this.process(chunk.slice(colonIndex + 1).trimStart())
      } else {
        // failsafe. check if accidentally continued to next key with a comma. If so, LLM probably meant to use "type": "key" instead of "key",
        const commaIndex = chunk.indexOf(",")
        if (commaIndex >= 0) {
          console.warn("[Structured Failsafe] Accidentally continued to next key.", this.currentKey, chunk, this)
          delete this.partial[this.currentKey]
          this.partial["type"] = this.currentKey
          this.partial.__done!.push("type")
          this.currentKey = ""
          this.state = "key"
          this.process(chunk.slice(commaIndex + 1).trim())
        }
      }
    } else if (this.state === "value") {
      if (this.valueStream) {
        this.valueStream.process(chunk)

        if (this.valueStream) {
          this.partial[this.currentKey] = this.valueStream.partial
        }
      } else {
        this.buffer += chunk

        const [s, r] = makeStructuredParser(this.buffer, {
          ...this.options,
          onComplete: (value: any, remainder: string) => {
            this.partial[this.currentKey] = value
            this.partial.__done!.push(this.currentKey)
            this.valueStream = null
            this.state = "comma"
            this.process(remainder)
          },
        })

        this.valueStream = s

        if (s) {
          this.buffer = ""
          s.process(r)

          if (this.valueStream) {
            this.partial[this.currentKey] = this.valueStream.partial
          }
        }
      }
    } else if (this.state === "comma") {
      this.buffer += chunk
      // Look for comma or end of object
      if (chunk.trimStart().startsWith(",")) {
        this.buffer = ""
        this.state = "key"
        this.process(chunk.slice(chunk.indexOf(",") + 1))
      } else if (chunk.trimStart().startsWith("}")) {
        this.partial.__completed = true
        this.end(chunk.slice(chunk.indexOf("}") + 1))
      } else if (chunk.trimStart().startsWith("]")) {
        this.partial.__completed = true
        this.end(chunk.slice(chunk.indexOf("]") + 1))
      } else if (chunk.trimStart().startsWith("{")) {
        this.partial.__completed = true
        this.end(chunk.slice(chunk.indexOf("{") + 1))
      } else if (chunk.trimStart().startsWith("[")) {
        this.partial.__completed = true
        this.end(chunk.slice(chunk.indexOf("[") + 1))
      } else if (chunk.trimStart().length > 0 && typeof this.partial[this.currentKey] === "string") {
        // failsafe when LLM forgets to escape strings
        const [s, r] = makeStructuredParser(this.quote + this.buffer, {
          ...this.options,
          onComplete: (value: any, remainder: string) => {
            this.partial[this.currentKey] = value
            this.partial.__done!.push(this.currentKey)
            this.valueStream = null
            this.state = "comma"
            this.process(remainder)
          },
        })

        this.valueStream = s

        if (s) {
          this.partial.__done = this.partial.__done!.filter((key) => key !== this.currentKey)
          this.state = "value"
          s.partial = this.partial[this.currentKey] + this.quote + ""
          this.buffer = ""
          s.process(r)

          if (this.valueStream) {
            this.partial[this.currentKey] = this.valueStream.partial
          }
        }
      }
    }
  }
}
