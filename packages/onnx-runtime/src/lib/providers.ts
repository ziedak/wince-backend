import type {
  ProviderConfig,
  ProviderName,
  ProviderStrategy,
} from '../types.js'
import { ProviderUnavailableError } from './errors'

/**
 * Default availability probing. Swap this out (via RuntimeOptions.providerStrategy)
 * if you need custom detection, e.g. checking a Node build flag for CUDA.
 */
export class DefaultProviderStrategy implements ProviderStrategy {
  async resolve(requested: ProviderConfig[]): Promise<ProviderConfig[]> {
    const available: ProviderConfig[] = []
    for (const provider of requested) {
      if (await this.isAvailable(provider.name)) {
        available.push(provider)
      }
    }
    if (available.length === 0) {
      throw new ProviderUnavailableError(requested.map((p) => p.name))
    }
    return available
  }

  protected async isAvailable(name: ProviderName): Promise<boolean> {
    switch (name) {
      case 'webgpu':
        return typeof navigator !== 'undefined' && 'gpu' in navigator
      case 'webgl':
        return typeof document !== 'undefined'
      case 'wasm':
      case 'cpu':
        return true
      // cuda / coreml / dml are Node-native providers baked into the ORT
      // build the caller injected; we can't probe them from JS, so we trust
      // the caller's request and let session creation fail loudly if wrong.
      case 'cuda':
      case 'coreml':
      case 'dml':
        return typeof window === 'undefined'
      default:
        return false
    }
  }
}
