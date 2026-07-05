import { OnnxRuntime } from './onnx-runtime.js'

describe('OnnxRuntime', () => {
  it('create uses injected backend', async () => {
    const backend = {
      InferenceSession: {
        create: async () => ({
          inputNames: ['x'],
          outputNames: ['y'],
          run: async () => ({ y: { type: 'float32', data: new Float32Array([1]), dims: [1] } }),
        }),
      },
      Tensor: class {
        constructor(public type: string, public data: Float32Array, public dims: number[]) {}
      },
    } as any;

    const runtime = OnnxRuntime.create({ backend } as any);
    const session = await runtime.createSession('model.onnx');
    expect(session.inputNames).toEqual(['x']);
    expect(session.outputNames).toEqual(['y']);
  });

  it('loadModel returns LoadedModel with session, ready, and isEnabled', async () => {
    const backend = {
      InferenceSession: {
        create: async () => ({
          inputNames: ['in'],
          outputNames: ['out'],
          run: async () => ({ out: { type: 'float32', data: new Float32Array([1]), dims: [1] } }),
        }),
      },
      Tensor: class {
        constructor(public type: string, public data: Float32Array, public dims: number[]) {}
      },
    } as any;

    const runtime = OnnxRuntime.create({ backend } as any);
    const loaded = await runtime.loadModel('model.onnx', { providers: [{ name: 'cpu' }] });
    await loaded.ready;
    expect(loaded.isEnabled()).toBe(true);
    expect(loaded.session.inputNames).toEqual(['in']);
  });

  it('shutdown disposes tracked sessions and clears optional cache', async () => {
    const backend = {
      InferenceSession: {
        create: async () => ({
          inputNames: ['in'],
          outputNames: ['out'],
          run: async () => ({ out: { type: 'float32', data: new Float32Array([1]), dims: [1] } }),
          release: async () => {},
        }),
      },
      Tensor: class {
        constructor(public type: string, public data: Float32Array, public dims: number[]) {}
      },
    } as any;

    const runtime = OnnxRuntime.create({ backend } as any);
    const session = await runtime.createSession('model.onnx');
    const clear = vi.fn(async () => {});
    const result = await runtime.shutdown({ clear } as any);
    expect(result.sessionsDisposed).toBe(1);
    expect(result.cacheCleared).toBe(true);
  });
});
