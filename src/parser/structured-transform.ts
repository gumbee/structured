import type * as z from "zod"
import { StructuredJson } from "@/parser/structured-json"
import { type DynamicRegistry } from "@/schema"
import { clean } from "@/utils"

export interface StructuredTransformOptions<T> {
  /** Schema to validate and guide parsing */
  schema?: z.ZodType<T>
  /** Registry for dynamic schema resolution */
  registry?: DynamicRegistry
  /** Callback invoked with any text that appears before the JSON content */
  onPreamble?: (text: string) => void
}

export interface StructuredTransformResult<T> {
  /** The TransformStream to pipe text through */
  stream: TransformStream<string, T>
  /** Promise resolving to the final parsed object */
  object: Promise<T>
  /** Promise resolving to the accumulated raw text */
  text: Promise<string>
}

/**
 * Creates a TransformStream that parses streaming text into structured JSON objects.
 *
 * This factory function returns a TransformStream that can be used with `pipeThrough()`
 * to transform a text stream into a stream of partial objects, along with promises
 * for the final object and accumulated text.
 *
 * @example
 * ```ts
 * const { stream, object, text } = createStructuredTransform({
 *   schema: z.object({ name: z.string(), age: z.number() }),
 * })
 *
 * // Pipe a text stream through the transform
 * const partials = textStream.pipeThrough(stream)
 *
 * // Consume partial objects as they build
 * for await (const partial of partials) {
 *   console.log(partial)
 * }
 *
 * // Or await the final object
 * const result = await object
 * ```
 */
export function createStructuredTransform<T>(options: StructuredTransformOptions<T> = {}): StructuredTransformResult<T> {
  const { schema, registry, onPreamble } = options

  // Create deferred promise for the final object
  let resolveObject: (value: T) => void
  let rejectObject: (error: unknown) => void
  const objectPromise = new Promise<T>((resolve, reject) => {
    resolveObject = resolve
    rejectObject = reject
  })

  // Create deferred promise for the accumulated text
  let resolveText: (value: string) => void
  let rejectText: (error: unknown) => void
  const textPromise = new Promise<string>((resolve, reject) => {
    resolveText = resolve
    rejectText = reject
  })

  // Track accumulated text and deduplication
  let accumulatedText = ""
  let lastEmittedJson: string | undefined

  const parser = new StructuredJson<T>({
    skipPreamble: true,
    schema,
    registry,
    onPreamble,
    onComplete: (json) => {
      resolveObject(clean(json))
    },
    onError: (error) => {
      rejectObject(error)
      rejectText(error)
    },
  })

  const stream = new TransformStream<string, T>({
    transform(chunk, controller) {
      accumulatedText += chunk
      parser.process(chunk)

      // Emit deduplicated partial values
      const value = parser.value
      if (value !== undefined) {
        const json = JSON.stringify(value)
        if (json !== lastEmittedJson) {
          lastEmittedJson = json
          controller.enqueue(value)
        }
      }
    },

    flush() {
      parser.finish()
      resolveText(accumulatedText)

      // If parser finished but onComplete wasn't called (incomplete JSON),
      // resolve with the last partial value
      if (parser.value !== undefined && parser.wasIncomplete) {
        resolveObject(clean(parser.value as T))
      }
    },
  })

  return {
    stream,
    object: objectPromise,
    text: textPromise,
  }
}

/**
 * Options for wrapping an async iterable with structured parsing
 */
export interface WrapAsyncIterableOptions<T> extends StructuredTransformOptions<T> {
  /** The provider name for error messages */
  provider: string
}

/**
 * Deep partial type for progressive object building
 */
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>
    }
  : T

/**
 * Result from wrapping an async iterable with structured parsing
 */
export interface WrapAsyncIterableResult<T> {
  /** AsyncIterable of partial objects */
  partials: AsyncIterable<DeepPartial<T>>
  /** Promise resolving to the final object (lazy - starts consumption when awaited) */
  object: Promise<T>
  /** Promise resolving to the accumulated text */
  text: Promise<string>
}

/**
 * Wraps an async iterable text source with structured parsing.
 *
 * This helper converts an async iterable of text chunks into a structured result
 * with partials stream, object promise, and text promise. It handles:
 * - Converting async iterable to ReadableStream
 * - Piping through the structured transform
 * - Lazy consumption (stream starts when partials are iterated or object is awaited)
 * - Stream single-use semantics
 *
 * @example
 * ```ts
 * // With OpenAI's stream
 * async function* textFromOpenAI() {
 *   for await (const chunk of openaiStream) {
 *     const content = chunk.choices[0]?.delta?.content
 *     if (content) yield content
 *   }
 * }
 *
 * const { partials, object, text } = wrapAsyncIterable(
 *   textFromOpenAI,
 *   { schema, provider: 'openai' }
 * )
 * ```
 */
export function wrapAsyncIterable<T>(
  createTextStream: () => AsyncIterable<string>,
  options: WrapAsyncIterableOptions<T>,
): WrapAsyncIterableResult<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { provider, ...transformOptions } = options

  // Create the structured transform
  const { stream: transformStream, object: objectPromise, text: textPromise } = createStructuredTransform<T>(transformOptions)

  // Create error helper
  const createError = (message: string, cause?: unknown) => {
    return new Error(`Structured generation failed: ${message}${cause ? ` (${cause})` : ""}`)
  }

  // Track stream consumption state
  let streamStarted = false
  let partialsStream: ReadableStream<T> | null = null

  // Convert async iterable to ReadableStream and pipe through transform
  function getPartialsStream(): ReadableStream<T> {
    if (!partialsStream) {
      const textIterable = createTextStream()
      const textStream = new ReadableStream<string>({
        async start(controller) {
          try {
            for await (const chunk of textIterable) {
              controller.enqueue(chunk)
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
      })

      partialsStream = textStream.pipeThrough(transformStream)
    }
    return partialsStream
  }

  // Consume the stream in the background (for lazy object access)
  async function consumeStreamInBackground(): Promise<void> {
    if (streamStarted) return
    streamStarted = true

    const stream = getPartialsStream()
    const reader = stream.getReader()

    try {
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    } catch (error) {
      throw createError(String(error), error)
    } finally {
      reader.releaseLock()
    }
  }

  // Wrap the stream to track consumption and provide AsyncIterable interface
  const partials: AsyncIterable<DeepPartial<T>> = {
    [Symbol.asyncIterator]() {
      if (streamStarted) {
        // Stream already consumed, return empty iterator
        return {
          async next() {
            return { done: true, value: undefined }
          },
        }
      }

      streamStarted = true
      const stream = getPartialsStream()
      const reader = stream.getReader()

      return {
        async next() {
          try {
            const { done, value } = await reader.read()
            if (done) {
              reader.releaseLock()
              return { done: true, value: undefined }
            }
            return { done: false, value: value as DeepPartial<T> }
          } catch (error) {
            reader.releaseLock()
            throw createError(String(error), error)
          }
        },
        async return() {
          reader.releaseLock()
          return { done: true, value: undefined }
        },
      }
    },
  }

  // Create a lazy object promise that auto-starts stream consumption
  const lazyObjectPromise: Promise<T> = {
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      if (!streamStarted) {
        consumeStreamInBackground()
      }
      return objectPromise.then(onfulfilled, onrejected)
    },
    catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult> {
      if (!streamStarted) {
        consumeStreamInBackground()
      }
      return objectPromise.catch(onrejected)
    },
    finally(onfinally?: (() => void) | null): Promise<T> {
      if (!streamStarted) {
        consumeStreamInBackground()
      }
      return objectPromise.finally(onfinally)
    },
    [Symbol.toStringTag]: "Promise",
  }

  return {
    partials,
    object: lazyObjectPromise,
    text: textPromise,
  }
}
