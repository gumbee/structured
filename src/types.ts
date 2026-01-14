import type { z } from "@/schema"
import type { DescribeRegistry } from "@/describe"

/**
 * Deep partial type for progressive object building
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>
    }
  : T

/**
 * Schema options for structured parsing
 */
export type StructuredSchemaOptions<T> =
  | {
      schema: z.ZodType<T>
      registry?: DescribeRegistry
    }
  | {
      registry: DescribeRegistry
    }

/**
 * Base options for rich widgets
 */
export type RichBaseOptions = {
  /** Registry containing all available widget schemas */
  widgets: DescribeRegistry
}

/**
 * Result type for rich widget streaming
 *
 * This type combines the widgets stream with adapter-specific result shape.
 * Each adapter defines its own TShape with finishReason, usage, response, etc.
 *
 * @typeParam T - The widget type (inferred from registry)
 * @typeParam TShape - Adapter-specific shape (e.g., { finishReason, usage, response })
 */
export type RichResult<T, TShape> = {
  /** Stream of partial widget arrays as they are progressively built */
  readonly widgets: AsyncIterable<DeepPartial<T[]>>
} & TShape

/**
 * Unified result interface for structured LLM output
 *
 * This interface is returned by all adapter-specific `structured` functions,
 * providing a consistent API regardless of the underlying LLM provider.
 *
 * @typeParam T - The schema type for the parsed object
 * @typeParam R - The raw SDK result type (gives access to all native SDK methods/properties)
 */
export interface StructuredResult<T, R = unknown> {
  /** Stream of partial objects as they are progressively built */
  partials: AsyncIterable<DeepPartial<T>>
  /** Promise resolving to the final parsed object */
  object: Promise<T>
  /** Promise resolving to the accumulated raw text content received by the parser */
  text: Promise<string>
  /** The raw SDK result/stream object with access to all native methods and properties */
  raw: R
}

/**
 * Error thrown when structured generation fails.
 *
 * This provides a consistent error format across all adapters, wrapping
 * provider-specific errors with additional context.
 */
export class StructuredError extends Error {
  /** The name of the error class */
  override name = "StructuredError" as const

  /** The original error from the provider, if available */
  public override readonly cause: unknown

  /** The provider that generated the error (e.g., 'openai', 'anthropic', 'ai-sdk') */
  public readonly provider: string

  /** The error code from the provider, if available */
  public readonly code?: string

  constructor(options: { message: string; cause?: unknown; provider: string; code?: string }) {
    // Wrap the message to indicate structured generation failure
    super(`Structured generation failed: ${options.message}`)
    this.cause = options.cause
    this.provider = options.provider
    this.code = options.code

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StructuredError)
    }
  }

  /**
   * Create a StructuredError from an unknown error value
   */
  static from(err: unknown, provider: string): StructuredError {
    if (err instanceof StructuredError) {
      return err
    }

    if (err instanceof Error) {
      return new StructuredError({
        message: err.message,
        cause: err,
        provider,
        code: (err as { code?: string }).code,
      })
    }

    // Handle plain object errors (e.g., from SSE streams)
    if (typeof err === "object" && err !== null) {
      const errorObj = err as { message?: string; error?: { message?: string; code?: string }; code?: string }
      const message = errorObj.message || errorObj.error?.message || JSON.stringify(err)
      const code = errorObj.code || errorObj.error?.code

      return new StructuredError({
        message,
        cause: err,
        provider,
        code,
      })
    }

    return new StructuredError({
      message: String(err),
      cause: err,
      provider,
    })
  }
}
