import { ProgressiveValue } from "@/parser/progressive-value"
import { makeStructuredParser } from "@/parser/factory"
import type { Progressive, StructuredParseOptions } from "@/parser/types"

/**
 * Schema-aware progressive array parser
 * Handles arrays with element schema awareness and alternate detection
 */
export class StructuredArray extends ProgressiveValue<Progressive<any[]>> {
  // the value stream that's currently processing the next array element
  #elementStream: ProgressiveValue | null = null
  #index: number = 0
  #buffer: string = ""

  constructor(options: StructuredParseOptions) {
    super(options)
    ;(this.partial as any).__completed = false
  }

  protected initial(): Progressive<any[]> {
    return [] as Progressive<any[]>
  }

  public process(chunk: string): void {
    if (chunk.length === 0) return

    if (this.#elementStream) {
      this.#elementStream.process(chunk)
    } else {
      if (chunk.trimStart().startsWith("]")) {
        // we don't have an active element and we're at the end of the array so we can end the stream
        ;(this.partial as any).__completed = true
        this.end(chunk.slice(chunk.indexOf("]") + 1))
      } else if (chunk.trimStart().startsWith(",")) {
        this.process(chunk.trimStart().slice(1))
      } else if (chunk.trimStart().startsWith("}")) {
        console.error("[Structured] Unexpected end of object in array")
        ;(this.partial as any).__completed = true
        this.end(chunk.slice(chunk.indexOf("}") + 1))
      } else {
        this.#buffer += chunk

        const [s, r] = makeStructuredParser(this.#buffer, {
          ...this.options,
          onComplete: (json: any, remainder: string) => {
            // we're done processing the current element so we can null out the stream
            this.error = this.error || (this.#elementStream?.error ?? false)
            this.#elementStream = null
            // add the element to the partial array
            this.partial[this.#index] = json
            this.#index++
            // process the next chunk
            this.process(remainder)
          },
        })

        this.#elementStream = s

        if (s) {
          this.#buffer = ""
          this.partial.push(s.partial)

          s.process(r)

          if (this.#elementStream) {
            this.partial[this.#index] = this.#elementStream.partial
          }
        }
      }
    }
  }
}
