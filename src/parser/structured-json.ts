import type * as z from "zod"
import { makeStructuredParser } from "@/parser/factory"
import { type ProgressiveValue } from "@/parser/progressive-value"
import { type DynamicRegistry } from "@/schema"
import { resolve } from "@/parser/resolver"

export interface StructuredJsonOptions<T> {
  /** Schema to validate and guide parsing */
  schema?: z.ZodType<T>
  /** Called when a complete JSON value is parsed. The remainder contains any text after the JSON. */
  onComplete?: (json: T, remainder: string) => void
  /**
   * Skip preamble text before JSON content (e.g., markdown code fences, explanatory text).
   * When true, parser will look for ```json, {, or [ to start parsing.
   * Defaults to false for direct JSON parsing.
   */
  skipPreamble?: boolean
  /**
   * Called with preamble text chunks as they arrive. Preamble is text that appears before
   * the JSON content. Only called when skipPreamble is true. Safe text is emitted as it arrives;
   * potential signature prefixes (e.g., backticks that could start ```json) are
   * held back until disambiguated by more input or finish() is called.
   */
  onPreamble?: (text: string) => void
  /**
   * Registry for dynamic schema resolution.
   * When provided, z.dynamic() schemas will resolve against this registry.
   */
  registry?: DynamicRegistry
  /**
   * When true, the parser will continue parsing after completing a JSON value,
   * looking for additional JSON values in the remainder. The parser will reset
   * after each complete value and call onComplete for each one.
   * Parsing continues until finish() is called.
   */
  multiple?: boolean
}

/**
 * Schema-aware progressive JSON parser
 *
 * @example
 * ```ts
 * const Icon = z.object({
 *   type: z.literal('icon'),
 *   icon: z.string().alias(['name'])
 * }).alternate(z.string(), v => ({ type: 'icon', icon: v }))
 *
 * const parser = new StructuredJson({
 *   schema: Icon,
 *   onComplete: (result) => console.log(result)
 * })
 *
 * parser.process('{"name": "home"}')
 * // Output: { type: 'icon', icon: 'home' } (name resolved to icon via alias)
 *
 * parser.process('"home"')
 * // Output: { type: 'icon', icon: 'home' } (string alternate applied)
 * ```
 */
export class StructuredJson<T = any> {
  #initialized: boolean = false
  #done: boolean = false
  #foundJsonStart: boolean = false
  wasIncomplete: boolean = false
  #onComplete?: (json: T, remainder: string) => void
  #onPreamble?: (text: string) => void
  #stream: ProgressiveValue | null = null
  #buffer: string = ""
  #skipPreamble: boolean
  #schema: z.ZodType<T> | undefined
  #registry: DynamicRegistry | undefined
  #multiple: boolean
  #emittedPreambleLength: number = 0

  /** Signatures that indicate the start of JSON content when skipPreamble is enabled */
  static readonly JSON_SIGNATURES = ["```json", "[", "{"] as const

  /** Prefixes of ```json signature that we need to hold back (could be start of signature) */
  static readonly #SIGNATURE_PREFIXES = ["`", "``", "```", "```j", "```js", "```jso"] as const

  /**
   * Get the current partial value being parsed
   */
  get value(): T | undefined {
    const result = resolve(this.#stream?.partial as T | undefined, { registry: this.#registry, schema: this.#schema, progressive: true })

    if (result.schema) {
      return result.output
    }

    return this.#stream?.partial as T | undefined
  }

  /**
   * Check if parsing is complete
   */
  get done(): boolean {
    return this.#done
  }

  constructor(options: StructuredJsonOptions<T> = {}) {
    this.#schema = options.schema
    this.#registry = options.registry
    this.#skipPreamble = options.skipPreamble ?? true
    this.#onPreamble = options.onPreamble
    this.#onComplete = options.onComplete
    this.#multiple = options.multiple ?? false
  }

  /**
   * Calculate the length of any signature prefix at the end of the buffer.
   * Returns the length of the longest matching prefix, or 0 if no match.
   */
  #getSignaturePrefixLength(): number {
    const buffer = this.#buffer

    // Check for potential ```json prefixes (longest first)
    const prefixes = StructuredJson.#SIGNATURE_PREFIXES
    for (let i = prefixes.length - 1; i >= 0; i--) {
      const prefix = prefixes[i] as string
      if (buffer.endsWith(prefix)) {
        return prefix.length
      }
    }

    return 0
  }

  /**
   * Emit safe preamble text that definitely isn't part of a JSON signature.
   * Holds back potential signature prefixes until more data arrives.
   */
  #emitSafePreamble(): void {
    if (!this.#onPreamble) return

    const prefixLength = this.#getSignaturePrefixLength()
    const safeEnd = this.#buffer.length - prefixLength

    if (safeEnd > this.#emittedPreambleLength) {
      const textToEmit = this.#buffer.slice(this.#emittedPreambleLength, safeEnd)
      this.#onPreamble(textToEmit)
      this.#emittedPreambleLength = safeEnd
    }
  }

  /**
   * Process a chunk of JSON text.
   * When skipPreamble is enabled, automatically skips preamble text before JSON content
   * (e.g., markdown code fences, explanatory text).
   */
  process(chunk: string): void {
    if (this.#done) return

    this.#buffer += chunk

    // Skip preamble if enabled and we haven't found JSON start yet
    if (this.#skipPreamble && !this.#foundJsonStart) {
      // Find the signature that occurs EARLIEST in the buffer, not the first
      // signature from the array that exists anywhere in the buffer.
      // This ensures we find `{` before `[` if `{` comes first in the input.
      let signature: string | undefined
      let signatureIndex = -1
      for (const sig of StructuredJson.JSON_SIGNATURES) {
        const idx = this.#buffer.indexOf(sig)
        if (idx !== -1 && (signatureIndex === -1 || idx < signatureIndex)) {
          signature = sig
          signatureIndex = idx
        }
      }

      if (signature && signatureIndex !== -1) {
        this.#foundJsonStart = true

        // Emit any remaining preamble text before the JSON signature (text not yet emitted)
        if (signatureIndex > this.#emittedPreambleLength && this.#onPreamble) {
          const remainingPreamble = this.#buffer.slice(this.#emittedPreambleLength, signatureIndex)
          if (remainingPreamble.length > 0) {
            this.#onPreamble(remainingPreamble)
          }
        }

        // Skip the ```json marker itself, keep { or [ in the buffer
        if (signature === "```json") {
          this.#buffer = this.#buffer.slice(signatureIndex + signature.length)
        } else {
          // For raw { or [, keep from the signature
          this.#buffer = this.#buffer.slice(signatureIndex)
        }
      } else {
        // No JSON signature found yet - emit safe preamble progressively
        this.#emitSafePreamble()
        return
      }
    }

    // Nothing to process after preamble handling
    if (this.#buffer.length === 0) return

    if (!this.#initialized) {
      const [s, r] = makeStructuredParser(this.#buffer, {
        schema: this.#schema,
        registry: this.#registry,
        onComplete: (json, remainder) => {
          this.#onComplete?.(json, remainder)

          if (this.#multiple) {
            // Reset parser state to be ready for more JSON values
            this.#initialized = false
            this.#foundJsonStart = false
            this.#stream = null
            this.#buffer = ""
            this.#emittedPreambleLength = 0
            // Process the remainder as new input (may contain next JSON or preamble)
            if (remainder.length > 0) {
              this.process(remainder)
            }
          } else {
            this.#done = true
          }
        },
      })

      if (s) {
        this.#initialized = true
        this.#buffer = ""
        this.#stream = s
        s.process(r)
      }
    } else {
      if (this.#stream && !this.#done) {
        // Save reference to detect if onComplete triggered a reset (multiple mode)
        const streamBeforeProcess = this.#stream
        this.#stream.process(this.#buffer)
        // Only clear buffer if no reset happened (stream wasn't nulled by onComplete)
        if (this.#stream === streamBeforeProcess) {
          this.#buffer = ""
        }
      }
    }
  }

  /**
   * Signal end of input - forces completion of parsers that need explicit termination
   * (e.g., numbers at the end of input)
   */
  finish(): void {
    // If we never found a JSON signature, emit any remaining buffered text as preamble
    if (this.#skipPreamble && !this.#foundJsonStart && this.#buffer && this.#onPreamble) {
      // Emit any text that hasn't been emitted yet (including held-back prefixes)
      if (this.#buffer.length > this.#emittedPreambleLength) {
        const remainingText = this.#buffer.slice(this.#emittedPreambleLength)
        if (remainingText.length > 0) {
          this.#onPreamble(remainingText)
        }
      }
    }

    if (this.#stream && !this.#done) {
      this.wasIncomplete = true
      this.#stream.finish()
    }
  }

  /**
   * Reset the parser to initial state
   */
  reset(): void {
    this.#initialized = false
    this.#done = false
    this.#foundJsonStart = false
    this.#stream = null
    this.#buffer = ""
    this.#emittedPreambleLength = 0
  }
}
