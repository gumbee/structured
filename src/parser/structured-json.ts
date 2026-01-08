import type * as z from "zod"
import { makeStructuredParser } from "./factory"
import { type ProgressiveValue } from "./progressive-value"
import { type DynamicRegistry } from "../schema"
import { resolve } from "./resolver"

export interface StructuredJsonOptions<T> {
  /** Schema to validate and guide parsing */
  schema?: z.ZodType<T>
  /** Called when a complete JSON value is parsed. The remainder contains any text after the JSON. */
  onComplete?: (json: T, remainder: string) => void
  /** Called when parsing encounters an error */
  onError?: (error: Error) => void
  /**
   * Skip preamble text before JSON content (e.g., markdown code fences, explanatory text).
   * When true, parser will look for ```json, {, or [ to start parsing.
   * Defaults to false for direct JSON parsing.
   */
  skipPreamble?: boolean
  /**
   * Called when preamble text is found before JSON starts.
   * Only called when skipPreamble is true and text exists before the JSON signature.
   */
  onPreamble?: (text: string) => void
  /**
   * Registry for dynamic schema resolution.
   * When provided, z.dynamic() schemas will resolve against this registry.
   */
  registry?: DynamicRegistry
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
  error: boolean = false
  wasIncomplete: boolean = false
  #onComplete?: (json: T, remainder: string) => void
  #onError?: (error: Error) => void
  #onPreamble?: (text: string) => void
  #stream: ProgressiveValue | null = null
  #buffer: string = ""
  #full: string = ""
  #skipPreamble: boolean
  #schema: z.ZodType<T> | undefined
  #registry: DynamicRegistry | undefined

  /** Signatures that indicate the start of JSON content when skipPreamble is enabled */
  static readonly JSON_SIGNATURES = ["```json", "[", "{"] as const

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
    this.#onError = options.onError
    this.#skipPreamble = options.skipPreamble ?? true
    this.#onPreamble = options.onPreamble
    this.#onComplete = options.onComplete
  }

  /**
   * Process a chunk of JSON text.
   * When skipPreamble is enabled, automatically skips preamble text before JSON content
   * (e.g., markdown code fences, explanatory text).
   */
  process(chunk: string): void {
    this.#full += chunk

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

        // Emit preamble text if there's any before the JSON signature
        const preambleText = this.#buffer.slice(0, signatureIndex)
        if (preambleText.trim() && this.#onPreamble) {
          this.#onPreamble(preambleText)
        }

        // Skip the ```json marker itself, keep { or [ in the buffer
        if (signature === "```json") {
          this.#buffer = this.#buffer.slice(signatureIndex + signature.length)
        } else {
          // For raw { or [, keep from the signature
          this.#buffer = this.#buffer.slice(signatureIndex)
        }
      } else {
        // No JSON signature found yet, keep buffering
        return
      }
    }

    // Nothing to process after preamble handling
    if (this.#buffer.length === 0) return

    try {
      if (!this.#initialized) {
        const [s, r] = makeStructuredParser(this.#buffer, {
          schema: this.#schema,
          registry: this.#registry,
          onComplete: (json, remainder) => {
            this.error = this.error || (s?.error ?? false)
            this.#done = true
            this.#onComplete?.(json, remainder)
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
          this.#stream.process(this.#buffer)
          this.#buffer = ""
        }
      }
    } catch (error) {
      this.#onError?.(error as Error)
    }
  }

  /**
   * Signal end of input - forces completion of parsers that need explicit termination
   * (e.g., numbers at the end of input)
   */
  finish(): void {
    // If we never found a JSON signature, emit the buffered text as preamble
    if (this.#skipPreamble && !this.#foundJsonStart && this.#buffer && this.#onPreamble) {
      this.#onPreamble(this.#buffer)
    }

    this.error = this.error || (this.#stream?.error ?? false)

    if (this.#stream && !this.#done) {
      this.wasIncomplete = true
      this.#stream.finish()
    }
    if (this.error) {
      console.log("Got a failsafe error in ", this.#full)
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
  }
}
