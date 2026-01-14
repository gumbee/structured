import { type StructuredParseOptions } from "@/parser/types"

/**
 * Base class for progressive value parsers
 * Adapted from apps/os/src/shared/features/progressive-json/progressive-value.ts
 */
export abstract class ProgressiveValue<T = any> {
  public partial: T
  protected completed: boolean = false
  public error: boolean = false
  protected options: StructuredParseOptions

  constructor(options: StructuredParseOptions) {
    this.options = options
    this.partial = this.initial()
  }

  protected abstract initial(): T

  // Process a chunk of data
  public abstract process(chunk: string): void

  // End the stream
  protected end(remainder: string): void {
    if (!this.completed) {
      this.completed = true
      this.options.onComplete?.(this.partial, remainder)
    }
  }

  // Force finish parsing (for values like numbers that need explicit termination)
  public finish(): void {
    this.end("")
  }
}
