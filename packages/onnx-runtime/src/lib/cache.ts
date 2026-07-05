import type { ICache } from '@org/types'
import type { SessionOptions } from '../types'
import type { OnnxRuntime } from './onnx-runtime'
import type { Session } from './session'

export class SessionCache {
  constructor(
    private readonly cache: ICache,
    private readonly runtime: OnnxRuntime
  ) {}

  has(key: string): Promise<boolean> {
    return this.cache.exists(key)
  }

  async getOrCreate(
    key: string,
    model: ArrayBuffer | Uint8Array | string,
    sessionOpts?: SessionOptions
  ): Promise<Session> {
    const hit = await this.cache.get<Session>(key)
    if (hit && hit.data && !hit.data?.isDisposed) {
      this.touch(key, hit.data)
      return hit.data
    }

    const session = await this.runtime.createSession(model, sessionOpts)
    this.set(key, session)
    return session
  }

  async peek(key: string): Promise<Session | null> {
    const hit = await this.cache.get<Session>(key)
    if (hit && hit.data && !hit.data?.isDisposed) {
      return hit.data
    }
    return null
  }

  async evict(key: string): Promise<void> {
    const session = await this.cache.get<Session>(key)
    if (!session || !session.data) return
    await this.cache.invalidate(key)
    await session.data.dispose()
  }

  async clear(): Promise<void> {
    const keys = await this.cache.keys()
    await Promise.all(keys.map((k) => this.evict(k)))
  }

  /** Dispose all cached sessions and clear underlying cache storage. */
  async dispose(): Promise<void> {
    await this.clear()
    await this.cache.dispose?.()
  }

  get size(): Promise<number> {
    return this.cache.size()
  }

  private set(key: string, session: Session): void {
    this.cache.set(key, session)
  }

  private touch(key: string, session: Session): void {
    this.cache.invalidate(key)
    this.cache.set(key, session)
  }
}
