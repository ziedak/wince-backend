import type {
  LoadedModelOptions,
  OrtBackend,
  ProviderStrategy,
  RuntimeOptions,
  RuntimeShutdownResult,
  SessionOptions,
} from '../types.js'
import { configureEnv } from './env'
import { SessionCreationError, RuntimeMisconfiguredError } from './errors'
import { DefaultProviderStrategy } from './providers'
import { Session } from './session'

/**
 * Entry point. Deliberately not a singleton: create one OnnxRuntime per backend/
 * env configuration you need (e.g. one for a WebGPU-first browser path, one
 * for a CPU-only Node worker), and they won't interfere with each other.
 */
export interface LoadedModel {
  session: Session
  /** Resolves when the model is loaded (or immediately if already loaded). */
  ready: Promise<void>
  /** Whether the model is currently available for inference. */
  isEnabled(): boolean
}

export class OnnxRuntime {
  private readonly backend: OrtBackend
  private readonly providerStrategy: ProviderStrategy
  private readonly sessions = new Set<Session>()

  private constructor(backend: OrtBackend, providerStrategy: ProviderStrategy) {
    this.backend = backend
    this.providerStrategy = providerStrategy
  }

  static create(options: RuntimeOptions): OnnxRuntime {
    configureEnv(options.backend, options.env)
    const strategy = options.providerStrategy ?? new DefaultProviderStrategy()
    return new OnnxRuntime(options.backend, strategy)
  }

  async createSession(
    model: ArrayBuffer | Uint8Array | string,
    opts: SessionOptions = {}
  ): Promise<Session> {
    const requested = opts.providers ?? [{ name: 'wasm' as const }]
    const resolved = await this.providerStrategy.resolve(requested)

    try {
      const raw = await this.backend.InferenceSession.create(model, {
        executionProviders: resolved.map((p) => p.name),
        ...opts.sessionOptions,
      })
      const session = new Session(raw, this.backend)
      this.sessions.add(session)
      return session
    } catch (cause) {
      throw new SessionCreationError(
        'Failed to create ONNX Runtime session',
        cause
      )
    }
  }

  /** Exposes the injected backend's tensor constructor for tensor.ts helpers. */
  get backendRef(): OrtBackend {
    return this.backend
  }

  /**
   * Lazy-load an ONNX model from a filesystem path or buffer.
   *
   * Returns an object exposing `session`, `ready`, and `isEnabled()`, matching
   * the initialization pattern currently duplicated in InferenceService.
   */
  async loadModel(
    model: ArrayBuffer | Uint8Array | string,
    opts: LoadedModelOptions = {}
  ): Promise<LoadedModel> {
    let session: Session | null = null
    let enabled = false

    const ready = (async () => {
      try {
        session = await this.createSession(model, opts)
        enabled = true
        if (opts.warmup) {
          try {
            if (typeof opts.warmup === 'function') {
              await opts.warmup()
            } else {
              const TensorCtor = session.backendRef.Tensor
              const input = new TensorCtor(
                'float32',
                new Float32Array([0]),
                [1, 1]
              )
              await session.run({ [session.inputNames[0]]: input })
            }
          } catch {
            // warmup is best-effort
          }
        }
      } catch {
        session = null
        enabled = false
      }
    })()

    return {
      get session(): Session {
        if (!session)
          throw new RuntimeMisconfiguredError('Model not loaded yet')
        return session
      },
      ready,
      isEnabled(): boolean {
        return enabled
      },
    }
  }

  /**
   * Dispose all sessions created by this runtime and clear internal tracking.
   * Optionally clear an associated cache.
   */
  async shutdown(cache?: {
    clear(): Promise<void>
  }): Promise<RuntimeShutdownResult> {
    let sessionsDisposed = 0
    for (const session of this.sessions) {
      try {
        await session.dispose()
        sessionsDisposed++
      } catch {
        // best-effort shutdown
      }
    }
    this.sessions.clear()
    let cacheCleared = false
    if (cache) {
      try {
        await cache.clear()
        cacheCleared = true
      } catch {
        cacheCleared = false
      }
    }
    return { sessionsDisposed, cacheCleared }
  }
}
