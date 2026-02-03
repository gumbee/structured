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
   * When true, parser will look for ```{signatureIdentifier}, {, or [ to start parsing.
   * Defaults to false for direct JSON parsing.
   */
  skipPreamble?: boolean
  /**
   * Called with preamble text chunks as they arrive. Preamble is text that appears before
   * the JSON content. Only called when skipPreamble is true. Safe text is emitted as it arrives;
   * potential signature prefixes (e.g., backticks that could start the code block signature) are
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
  /**
   * The language identifier for code block signatures (e.g., "structured", "widgets").
   * Parser will look for ```{signatureIdentifier} to start JSON parsing.
   * Defaults to "structured".
   */
  signatureIdentifier?: string
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
  #insideCodeFence: boolean = false
  #signatureIdentifier: string

  /** Pattern to detect start of any code fence (``` followed by at least one letter for language identifier) */
  static readonly #CODE_FENCE_START = /```[a-zA-Z]+/

  /** Pattern to detect closing code fence */
  static readonly #CODE_FENCE_CLOSE = "\n```"

  /**
   * Get the code block signature (e.g., "```structured" or "```widgets")
   */
  get #codeBlockSignature(): string {
    return "```" + this.#signatureIdentifier
  }

  /**
   * Get signatures that indicate the start of JSON content when skipPreamble is enabled.
   * Includes the code block signature and raw JSON delimiters.
   */
  get #jsonSignatures(): readonly string[] {
    return [this.#codeBlockSignature, "[", "{"] as const
  }

  /**
   * Generate all prefixes of the code block signature that we need to hold back
   * (could be start of signature). For "```structured", this would be:
   * ["`", "``", "```", "```s", "```st", "```str", "```stru", "```struc", "```struct", "```structu", "```structur", "```structure"]
   */
  get #signaturePrefixes(): readonly string[] {
    const sig = this.#codeBlockSignature
    const prefixes: string[] = []
    // Generate all prefixes from length 1 to length-1 (full signature is not a prefix)
    for (let i = 1; i < sig.length; i++) {
      prefixes.push(sig.slice(0, i))
    }
    return prefixes
  }

  /**
   * Generate prefixes of the code block signature that start with "```" (the fence start).
   * These are used to check if a code fence could still become our target signature.
   * For "```structured", this would be: ["```s", "```st", "```str", ...]
   */
  get #fencePrefixes(): readonly string[] {
    const sig = this.#codeBlockSignature
    const prefixes: string[] = []
    // Start from "```" + first char of identifier
    for (let i = 4; i < sig.length; i++) {
      prefixes.push(sig.slice(0, i))
    }
    return prefixes
  }

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
    this.#signatureIdentifier = options.signatureIdentifier ?? "structured"
  }

  /**
   * Calculate the length of any signature prefix at the end of the buffer.
   * Returns the length of the longest matching prefix, or 0 if no match.
   */
  #getSignaturePrefixLength(): number {
    const buffer = this.#buffer

    // Check for potential code block signature prefixes (longest first)
    const prefixes = this.#signaturePrefixes
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
   * Check if the given index in the buffer is at the start of a line.
   * Returns true if index is 0, preceded by a newline, or preceded only by whitespace
   * (spaces/tabs) after a newline or start of buffer.
   * This allows JSON like "  {" or "\t[" to be detected as line-start signatures.
   */
  #isAtLineStart(index: number): boolean {
    if (index === 0) return true

    // Look backwards from index, skipping spaces and tabs
    let i = index - 1
    while (i >= 0) {
      const char = this.#buffer[i]
      if (char === "\n") return true
      if (char === " " || char === "\t") {
        i--
        continue
      }
      // Found a non-whitespace, non-newline character
      return false
    }
    // Reached start of buffer through whitespace only
    return true
  }

  /**
   * Try to skip non-target code fences in the buffer.
   * Returns true if we're inside a code fence and waiting for it to close.
   * Emits skipped content as preamble.
   */
  #trySkipCodeFences(): boolean {
    // If we're inside a code fence, look for the closing ```
    if (this.#insideCodeFence) {
      const closeIndex = this.#buffer.indexOf(StructuredJson.#CODE_FENCE_CLOSE, this.#emittedPreambleLength)
      if (closeIndex !== -1) {
        // Found closing fence - emit everything including the closing fence as preamble
        const endOfCloseFence = closeIndex + StructuredJson.#CODE_FENCE_CLOSE.length
        if (endOfCloseFence > this.#emittedPreambleLength) {
          if (this.#onPreamble) {
            const textToEmit = this.#buffer.slice(this.#emittedPreambleLength, endOfCloseFence)
            this.#onPreamble(textToEmit)
          }
          // Always update position to ensure progress (prevents infinite recursion)
          this.#emittedPreambleLength = endOfCloseFence
        }
        this.#insideCodeFence = false
        // Continue to check for more code fences or signatures
        return this.#trySkipCodeFences()
      } else {
        // Still inside code fence, emit safe content (but hold back potential closing prefix)
        // Check if buffer ends with a potential closing fence prefix (\n, \n`, \n``, \n```)
        let holdBackLength = 0
        const closePrefixes = ["\n", "\n`", "\n``", "\n```"]
        for (let i = closePrefixes.length - 1; i >= 0; i--) {
          if (this.#buffer.endsWith(closePrefixes[i]!)) {
            holdBackLength = closePrefixes[i]!.length
            break
          }
        }
        const safeEnd = this.#buffer.length - holdBackLength
        if (safeEnd > this.#emittedPreambleLength) {
          if (this.#onPreamble) {
            const textToEmit = this.#buffer.slice(this.#emittedPreambleLength, safeEnd)
            this.#onPreamble(textToEmit)
          }
          // Always update position to ensure progress
          this.#emittedPreambleLength = safeEnd
        }
        return true // Still inside code fence
      }
    }

    // Look for any code fence start (``` followed by language identifier)
    const fenceMatch = StructuredJson.#CODE_FENCE_START.exec(this.#buffer.slice(this.#emittedPreambleLength))
    if (fenceMatch) {
      const fenceStart = this.#emittedPreambleLength + fenceMatch.index
      const fenceContent = fenceMatch[0]
      const targetSignature = this.#codeBlockSignature

      // Check if this is our target signature - if so, don't skip it
      if (fenceContent === targetSignature || this.#buffer.slice(fenceStart).startsWith(targetSignature)) {
        return false // Don't skip, this is our target signature
      }

      // Check if this could still become our target signature (partial prefix)
      const targetFencePrefixes = this.#fencePrefixes
      if (targetFencePrefixes.includes(fenceContent)) {
        // Check what comes after in the buffer
        const afterFence = this.#buffer.slice(fenceStart + fenceContent.length)
        if (afterFence.length === 0) {
          // Need more input to determine if this becomes our target signature
          return false
        }
        // Check if remaining content could still form our target signature
        const remainingNeeded = this.#signatureIdentifier.slice(fenceContent.length - 3) // e.g., for ```s, need "tructured"
        if (remainingNeeded && afterFence.length < remainingNeeded.length) {
          // Check if what we have matches the prefix of what's needed
          if (remainingNeeded.startsWith(afterFence)) {
            // Could still become our target signature
            return false
          }
        }
      }

      // This is a non-target code fence - skip it
      // Emit preamble up to the fence start
      if (fenceStart > this.#emittedPreambleLength) {
        if (this.#onPreamble) {
          const textToEmit = this.#buffer.slice(this.#emittedPreambleLength, fenceStart)
          this.#onPreamble(textToEmit)
        }
        // Always update position to ensure progress
        this.#emittedPreambleLength = fenceStart
      }

      // Find end of the fence opening line (look for newline or end of buffer)
      const fenceEnd = fenceStart + fenceContent.length
      // Check for closing fence
      const closeIndex = this.#buffer.indexOf(StructuredJson.#CODE_FENCE_CLOSE, fenceEnd)
      if (closeIndex !== -1) {
        // Found closing fence - emit everything including the closing fence as preamble
        const endOfCloseFence = closeIndex + StructuredJson.#CODE_FENCE_CLOSE.length
        if (endOfCloseFence > this.#emittedPreambleLength) {
          if (this.#onPreamble) {
            const textToEmit = this.#buffer.slice(this.#emittedPreambleLength, endOfCloseFence)
            this.#onPreamble(textToEmit)
          }
          // Always update position to ensure progress (prevents infinite recursion)
          this.#emittedPreambleLength = endOfCloseFence
        }
        // Check for more code fences
        return this.#trySkipCodeFences()
      } else {
        // No closing fence yet - mark as inside code fence
        this.#insideCodeFence = true
        // Emit what we can safely (hold back potential closing prefix)
        let holdBackLength = 0
        const closePrefixes = ["\n", "\n`", "\n``", "\n```"]
        for (let i = closePrefixes.length - 1; i >= 0; i--) {
          if (this.#buffer.endsWith(closePrefixes[i]!)) {
            holdBackLength = closePrefixes[i]!.length
            break
          }
        }
        const safeEnd = this.#buffer.length - holdBackLength
        if (safeEnd > this.#emittedPreambleLength) {
          if (this.#onPreamble) {
            const textToEmit = this.#buffer.slice(this.#emittedPreambleLength, safeEnd)
            this.#onPreamble(textToEmit)
          }
          // Always update position to ensure progress
          this.#emittedPreambleLength = safeEnd
        }
        return true // Inside code fence, waiting for close
      }
    }

    return false // No code fence to skip
  }

  /**
   * Find the earliest valid signature in the buffer after any emitted preamble.
   * For { and [, they must be at line start. For the code block signature, position doesn't matter.
   */
  #findEarliestValidSignature(): { signature: string; index: number } | null {
    let bestSignature: string | undefined
    let bestIndex = -1

    // Only search after already-emitted preamble content
    const searchFromIndex = this.#emittedPreambleLength

    for (const sig of this.#jsonSignatures) {
      let searchStart = searchFromIndex
      while (true) {
        const idx = this.#buffer.indexOf(sig, searchStart)
        if (idx === -1) break

        // For { and [, check if at line start
        if (sig === "{" || sig === "[") {
          if (!this.#isAtLineStart(idx)) {
            // Not at line start, keep searching
            searchStart = idx + 1
            continue
          }
        }

        // Valid signature found
        if (bestIndex === -1 || idx < bestIndex) {
          bestSignature = sig
          bestIndex = idx
        }
        break // Found earliest valid occurrence of this signature
      }
    }

    if (bestSignature && bestIndex !== -1) {
      return { signature: bestSignature, index: bestIndex }
    }
    return null
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
      // First, try to skip any non-target code fences
      if (this.#trySkipCodeFences()) {
        // Still inside a code fence, need more input
        return
      }

      // Find the earliest valid signature in the buffer
      // For { and [, they must be at line start. For the code block signature, position doesn't matter.
      const found = this.#findEarliestValidSignature()

      if (found) {
        const { signature, index: signatureIndex } = found
        this.#foundJsonStart = true

        // Emit any remaining preamble text before the JSON signature (text not yet emitted)
        if (signatureIndex > this.#emittedPreambleLength && this.#onPreamble) {
          const remainingPreamble = this.#buffer.slice(this.#emittedPreambleLength, signatureIndex)
          if (remainingPreamble.length > 0) {
            this.#onPreamble(remainingPreamble)
          }
        }

        // Skip the code block marker itself, keep { or [ in the buffer
        if (signature === this.#codeBlockSignature) {
          this.#buffer = this.#buffer.slice(signatureIndex + signature.length)
        } else {
          // For raw { or [, keep from the signature
          this.#buffer = this.#buffer.slice(signatureIndex)
        }
      } else {
        // No valid JSON signature found yet - emit safe preamble progressively
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
            this.#insideCodeFence = false // Reset code fence state to prevent stale state
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
    this.#insideCodeFence = false
  }
}
