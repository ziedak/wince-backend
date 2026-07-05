import type {
  Disposable,
  OrtBackend,
  RawSession,
  RawTensor,
  SessionIntrospection,
  TensorDtype,
} from '../types.js'
import { InferenceError, OrtWrapperError } from './errors'

export class Session implements Disposable {
  private disposed = false

  constructor(
    private readonly raw: RawSession,
    /** Exposed so helpers like InferenceSession can construct tensors. */
    public readonly backendRef: OrtBackend
  ) {}

  get inputNames(): readonly string[] {
    return this.raw.inputNames
  }

  get outputNames(): readonly string[] {
    return this.raw.outputNames
  }

  async run(
    feeds: Record<string, RawTensor>
  ): Promise<Record<string, RawTensor>> {
    if (this.disposed) {
      throw new OrtWrapperError(
        'Cannot run a disposed session',
        'SESSION_DISPOSED'
      )
    }
    try {
      return await this.raw.run(feeds)
    } catch (cause) {
      throw new InferenceError('Inference failed', cause)
    }
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.raw.release?.()
    this.disposed = true
  }

  /**
   * Lightweight introspection of session input/output metadata.
   * Names are always available; dtype/dims are best-effort and may be empty
   * if the underlying runtime does not expose them.
   */
  async introspect(): Promise<SessionIntrospection> {
    const inputMeta = this.raw.inputNames.map((name) => ({
      name,
      dtype: 'float32' as TensorDtype,
      dims: [],
    }))
    const outputMeta = this.raw.outputNames.map((name) => ({
      name,
      dtype: 'float32' as TensorDtype,
      dims: [],
    }))

    return { inputMeta, outputMeta }
  }
}
