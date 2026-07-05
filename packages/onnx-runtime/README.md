# ort-wrapper

A thin, safe layer over ONNX Runtime. It does not import `onnxruntime-web`
or `onnxruntime-node` itself — you inject the backend you need. That single
decision is what makes browser/Node support, tree-shaking, and Vite
compatibility fall out for free: there's no environment-sniffing branch
inside the package for a bundler to choke on.

## Browser (Vite)

```ts
import * as ort from 'onnxruntime-web';
import { Runtime, toFloat32Tensor } from '@yourscope/ort-wrapper';

const runtime = Runtime.create({
  backend: ort,
  env: { wasm: { wasmPaths: '/ort-wasm/' } }, // you control asset resolution
});

const session = await runtime.createSession('/models/scorer.onnx', {
  providers: [{ name: 'webgpu' }, { name: 'wasm' }], // ordered fallback
});

const input = toFloat32Tensor(runtime.backendRef, [0.1, 0.2, 0.3], [1, 3]);
const outputs = await session.run({ input });
```

## Node

```ts
import * as ort from 'onnxruntime-node';
import { Runtime } from '@yourscope/ort-wrapper';

const runtime = Runtime.create({ backend: ort });
const session = await runtime.createSession('./model.onnx', {
  providers: [{ name: 'cpu' }],
});
```

## Caching sessions

```ts
import { SessionCache } from '@yourscope/ort-wrapper';

const cache = new SessionCache(runtime, { maxEntries: 4 });
const session = await cache.getOrCreate('scorer-v3', './scorer-v3.onnx', {
  providers: [{ name: 'cpu' }],
});
// LRU eviction calls session.dispose() automatically
```

## Error handling

Every failure mode is a typed subclass of `OrtWrapperError` with a `code`:
`PROVIDER_UNAVAILABLE`, `SESSION_CREATION_FAILED`, `SESSION_DISPOSED`,
`INFERENCE_FAILED`, `TENSOR_SHAPE_MISMATCH`, `RUNTIME_MISCONFIGURED`.

```ts
import { ProviderUnavailableError } from '@yourscope/ort-wrapper';

try {
  await runtime.createSession(model, { providers: [{ name: 'webgpu' }] });
} catch (e) {
  if (e instanceof ProviderUnavailableError) {
    // fall back, log, whatever — you get a real type, not a string match
  }
}
```

## High-level inference

`InferenceSession` composes `Session` with production-ready resilience:

- per-call timeout
- circuit breaker (duck-typed; compatible with `cockatiel`)
- bounded retry with backoff delays
- `null`-on-failure fallback semantics
- optional observability callbacks
- optional warmup

```ts
import { InferenceSession, CircuitBreaker, InferenceCallbacks } from '@yourscope/ort-wrapper';

const callbacks: InferenceCallbacks = {
  onDuration(ms) { metrics.record(ms); },
  onFallback() { metrics.fallback(); },
  onCircuitOpen() { logger.warn('circuit open'); },
  onCircuitClosed() { logger.info('circuit closed'); },
};

const inference = new InferenceSession(session, {
  timeoutMs: 50,
  callbacks,
  circuitBreaker: myBreaker,
  retry: { attempts: 2, delaysMs: [100] },
  warmup: true,
});

const result = await inference.predict(feeds);
// { confidence: 0.92, type?: ..., channel?: ..., value?: ... } | null
```

Use `predictFromArray` for single-input float32 models:

```ts
const result = await inference.predictFromArray('features', [0.1, 0.2, 0.3, 0], [1, 4]);
```

Or `predictFromMap` for multi-input models:

```ts
const result = await inference.predictFromMap(new Map([
  ['a', { data: [0.1, 0.2], dims: [1, 2] }],
  ['b', { data: [0.3, 0.4], dims: [1, 2] }],
]));
```

## Model loading helpers

`OnnxRuntime.loadModel(model, opts?)` returns `{ session, ready, isEnabled() }` and supports:

- provider selection
- automatic optional warmup

```ts
const model = await runtime.loadModel('./model.onnx', {
  providers: [{ name: 'cpu' }],
  warmup: true,
});
await model.ready;
if (model.isEnabled()) {
  const inference = new InferenceSession(model.session, ...);
}
```

## Session introspection

```ts
const meta = await session.introspect();
// { inputMeta: [{ name, dtype, dims }], outputMeta: [...] }
```

## Cache improvements

`SessionCache` maintains an internal `entries` map so `size` is accurate and offers `peek(key)` without LRU bump, plus `disposeAll()`:

```ts
const cached = await cache.peek('scorer-v3');
await cache.disposeAll();
```

## Graceful shutdown

```ts
await runtime.shutdown(cache);
// returns { sessionsDisposed, cacheCleared }
```

## Why it's structured this way

- **Zero global state** — no module-level singletons. Two `Runtime`
  instances never share env config or providers unless you explicitly
  share the instance.
- **SOLID** — `ProviderStrategy` is an interface; `DefaultProviderStrategy`
  is one implementation. Swap in your own (e.g. probing for CUDA in a
  specific Node build) without touching `Runtime`.
- **Minimal surface** — core exports plus tensor helpers, error types,
  and opt-in resilience wrappers. No config object with forty optional fields.
- **Disposal is explicit** — `Session.dispose()`, `SessionCache.clear()`,
  `SessionCache.disposeAll()`, and `OnnxRuntime.shutdown()` are the only
  ways resources go away; nothing relies on GC or `finally` blocks you
  forgot to write.
