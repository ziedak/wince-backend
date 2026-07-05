import type {
  InferenceOutput,
  CircuitBreaker,
  InferenceCallbacks,
  InferenceOptions as BaseInferenceOptions,
  RawTensor,
  TensorData,
} from '../types'
import { OrtWrapperError } from './errors'
import type { Session } from './session'
import { toTensor } from './tensor'

export { type CircuitBreaker, type InferenceCallbacks } from '../types'

export type InferenceOptions = BaseInferenceOptions

// Re-export lightweight option types from types package for consumers.
export type {
  LoadedModelOptions,
  SessionIntrospection,
  RuntimeShutdownResult,
} from '../types'

/**
 * High-level ONNX inference wrapper that composes:
 *  - per-call timeout
 *  - circuit breaker
 *  - bounded retry with backoff
 *  - null-on-failure fallback semantics
 *  - optional observability
 *  - optional warmup
 */
export class InferenceSession {
  private disposed = false
  private readonly timeoutMs: number
  private readonly breaker: CircuitBreaker | undefined
  private readonly callbacks: InferenceCallbacks | undefined
  private readonly retry: { attempts: number; delaysMs: number[] } | undefined
  private readonly warmupFn: (() => Promise<void>) | undefined
  private warmedUp = false

  constructor(
    private readonly session: Session,
    options: InferenceOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 50
    this.breaker = options.circuitBreaker
    this.callbacks = options.callbacks
    this.retry = options.retry
    this.warmupFn =
      typeof options.warmup === 'function'
        ? options.warmup
        : options.warmup === true
          ? () => this.defaultWarmup()
          : undefined

    if (this.breaker?.onBreak) {
      this.breaker.onBreak(() => this.callbacks?.onCircuitOpen?.())
    }
    if (this.breaker?.onReset) {
      this.breaker.onReset(() => this.callbacks?.onCircuitClosed?.())
    }
  }

  /**
   * Run inference, returning null on any failure (timeout, circuit open,
   * runtime error, disposed session). Consumers use this as the standard
   * "try model, fall back to rules" entrypoint.
   */
  async predict(
    feeds: Record<string, RawTensor>
  ): Promise<InferenceOutput | null> {
    if (this.disposed) {
      throw new OrtWrapperError(
        'Cannot run inference on a disposed session',
        'SESSION_DISPOSED'
      )
    }

    const start = Date.now()
    try {
      const result = await this.executeWithResilience(feeds)
      this.callbacks?.onDuration?.(Date.now() - start)
      await this.maybeWarmup()
      return result
    } catch (err) {
      this.callbacks?.onFallback?.()
      this.callbacks?.onDuration?.(Date.now() - start)
      return null
    }
  }

  /**
   * Convenience for the common float32 input case.
   */
  async predictFromArray(
    inputName: string,
    data: number[] | Float32Array,
    dims: number[]
  ): Promise<InferenceOutput | null> {
    const tensor = this.toFloat32Tensor(data, dims)
    return this.predict({ [inputName]: tensor })
  }

  /**
   * Typed convenience: returns confidence as a number and passes through
   * extra tensor outputs untyped beyond `TensorData`.
   */
  async predictTyped(
    feeds: Record<string, RawTensor>
  ): Promise<InferenceOutput | null> {
    const out = await this.predict(feeds)
    return out ? { ...out } : null
  }

  /**
   * Multi-input helper. Builds a feeds map from a name -> {data, dims} map.
   */
  predictFromMap(
    inputs: Map<string, { data: number[] | Float32Array; dims: number[] }>
  ): Promise<InferenceOutput | null> {
    const feeds: Record<string, RawTensor> = {}
    for (const [name, { data, dims }] of inputs) {
      feeds[name] = this.toFloat32Tensor(data, dims)
    }
    return this.predict(feeds)
  }

  /**
   * Build a float32 tensor from the session's backend.
   */
  toFloat32Tensor(data: number[] | Float32Array, dims: number[]): RawTensor {
    const typed = data instanceof Float32Array ? data : Float32Array.from(data)
    return toTensor(this.session.backendRef, typed, dims, 'float32')
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.session.dispose()
    this.disposed = true
  }

  private async defaultWarmup(): Promise<void> {
    const input = this.toFloat32Tensor(
      new Array(this.session.inputNames.length).fill(0),
      [1, this.session.inputNames.length]
    )
    await this.session.run({ [this.session.inputNames[0] as string]: input })
  }

  private async maybeWarmup(): Promise<void> {
    if (this.warmedUp) return
    if (!this.warmupFn) return
    this.warmedUp = true
    try {
      await this.warmupFn()
    } catch {
      // warmup is best-effort
    }
  }

  private async executeWithResilience(
    feeds: Record<string, RawTensor>
  ): Promise<InferenceOutput> {
    const attempts = this.retry?.attempts ?? 1
    const delays = this.retry?.delaysMs ?? []
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.runOnce(feeds)
      } catch (err) {
        lastError = err as Error
        if (attempt < attempts - 1 && delays[attempt] !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
        }
      }
    }

    if (lastError) throw lastError
    throw new OrtWrapperError(
      'Inference failed after retries',
      'INFERENCE_FAILED'
    )
  }

  private async runOnce(
    feeds: Record<string, RawTensor>
  ): Promise<InferenceOutput> {
    const run = () =>
      Promise.race([this.session.run(feeds), this.timeout(this.timeoutMs)])
    const breaker = this.breaker
    const guarded = breaker ? () => breaker.execute(run) : run

    const output = await guarded()

    const confidenceTensor = output['confidence']
    if (!confidenceTensor) {
      throw new OrtWrapperError(
        'ONNX output missing "confidence" node',
        'RUNTIME_MISCONFIGURED'
      )
    }

    const rawConfidence = (confidenceTensor.data as Float32Array)[0] ?? 0
    if (rawConfidence == null) {
      throw new OrtWrapperError(
        'ONNX confidence tensor is empty',
        'RUNTIME_MISCONFIGURED'
      )
    }

    const confidence = Math.max(0, Math.min(1, rawConfidence))

    const result: InferenceOutput = { confidence }
    for (const key of Object.keys(output)) {
      if (key !== 'confidence') {
        result[key] = output[key].data as TensorData
      }
    }
    return result
  }

  /** Run a single no-op warmup inference using zeros for all inputs. */
  async runWarmup(): Promise<void> {
    if (!this.session.inputNames.length) return
    const zeros = this.toFloat32Tensor(
      new Array(this.session.inputNames.length).fill(0),
      [1, this.session.inputNames.length]
    )
    await this.session.run({ [this.session.inputNames[0] as string]: zeros })
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`ONNX inference timed out after ${ms}ms`)),
        ms
      )
    )
  }
}
