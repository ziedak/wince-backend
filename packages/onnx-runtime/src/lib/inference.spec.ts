import { describe, it, expect, vi } from 'vitest'
import type { RawTensor } from '../types.js'
import { InferenceSession } from './inference.js'
import type { Session } from './session.js'

function createFakeSession(
  inputNames: string[] = ['features'],
  outputNames: string[] = ['confidence'],
  runImpl: (
    feeds: Record<string, RawTensor>
  ) => Promise<Record<string, RawTensor>> = async () => ({
    confidence: { type: 'float32', data: new Float32Array([0.9]), dims: [1] },
  })
): Session {
  return {
    inputNames,
    outputNames,
    run: runImpl,
    backendRef: {} as any,
    isDisposed: false,
    dispose: async () => {
      /* empty */
    },
  } as unknown as Session
}

describe('InferenceSession', () => {
  it('throws when inference session is disposed', async () => {
    const session = createFakeSession()
    const inference = new InferenceSession(session as any)
    await inference.dispose()
    await expect(
      inference.predict({
        foo: { type: 'float32', data: new Float32Array([1]), dims: [1] },
      } as any)
    ).rejects.toThrow('Cannot run inference on a disposed session')
  })

  it('falls back to null on timeout', async () => {
    const session = createFakeSession([], [], async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return {}
    })
    const inference = new InferenceSession(session as any, { timeoutMs: 50 })
    const result = await inference.predict({
      foo: { type: 'float32', data: new Float32Array([1]), dims: [1] },
    } as any)
    expect(result).toBeNull()
  })

  it('does not throw when circuit breaker is present but callbacks are absent', async () => {
    const breaker = {
      execute: async (fn: () => Promise<any>) => fn(),
    }
    const session = createFakeSession()
    const inference = new InferenceSession(session as any, {
      circuitBreaker: breaker as any,
    })
    const result = await inference.predict({
      foo: { type: 'float32', data: new Float32Array([1]), dims: [1] },
    } as any)
    expect(result).not.toBeNull()
  })
})
