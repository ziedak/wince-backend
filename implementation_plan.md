# Implementation Plan

[Overview]
Enhance `@org/onnx-runtime` with missing resilience, usability, and introspection features identified from `apps/decision-engine` usage patterns and gaps in the current package API.

This plan addresses both missing abstractions that decision-engine currently reimplements (timeout, circuit breaker, fallback, lazy loading, observability hooks) and broader ONNX usability gaps in the package itself (generic typed outputs, multi-input helpers, warmup, cache bug fix, graceful shutdown, schema introspection). The existing API is backward compatible; additions are opt-in extensions.

[Types]
Extend the package type system to support richer inference options, explicit output typing, helper methods, and lifecycle management contracts.

Detailed definitions:
- `InferenceOutput<T extends Record<string, TensorData> = Record<string, TensorData>>` — generic so extra model outputs preserve tensor types.
- `InferenceSessionOptions extends InferenceOptions { warmup?: boolean | (() => Promise<void>); retry?: { attempts: number; delaysMs: number[] } }` — adds warmup toggle and bounded retry with backoff delays.
- `LoadedModelOptions extends SessionOptions { warmup?: boolean | (() => Promise<void>) }` — provider control and warmup at load time.
- `SessionIntrospection { inputMeta: Array<{ name: string; dtype: TensorDtype; dims: number[] }>; outputMeta: Array<{ name: string; dtype: TensorDtype; dims: number[] }> }` — light introspection result type.
- `RuntimeShutdownResult { sessionsDisposed: number; cacheCleared: boolean }` — shutdown contract result.

[Files]
Modify package source files and add targeted tests; no deletion or moving.

- `packages/onnx-runtime/src/types.ts` — add new type aliases/interfaces listed above.
- `packages/onnx-runtime/src/lib/inference.ts` — genericize `InferenceOutput`, add `retry` execution path, add `predictFromMap` multi-input helper, add typed extraction utility.
- `packages/onnx-runtime/src/lib/onnx-runtime.ts` — update `loadModel` signature to accept `LoadedModelOptions`, perform optional warmup.
- `packages/onnx-runtime/src/lib/session.ts` — add `introspect()` helper; fix any typing issues with `backendRef`.
- `packages/onnx-runtime/src/lib/cache.ts` — fix `size` getter (`exists` is async; use cached `entries` count), add `peek` and `disposeAll`.
- `packages/onnx-runtime/src/lib/onnx-runtime.ts` — add `shutdown()` to dispose sessions and clear cache atomically.
- `packages/onnx-runtime/src/index.ts` — re-export new public API.
- `packages/onnx-runtime/src/lib/inference.spec.ts` — add tests for retry, fallback, warmup, generic outputs.
- `packages/onnx-runtime/src/lib/onnx-runtime.spec.ts` — add tests for `loadModel` options and `shutdown`.
- `packages/onnx-runtime/README.md` — document new APIs.

[Functions]
Add and refine package-level functions.

- `InferenceSession.predict(feeds)` — update to generic `InferenceOutput<T>` pass-through and stable typing.
- `InferenceSession.predictFromArray` — keep as convenience; add `predictFromMap(name→data[])`.
- `InferenceSession.predictFromMap(inputs: Map<string, { data: number[] | TypedArray; dims: number[] }>)` — new multi-input helper.
- `InferenceSession.toFloat32Tensor` — keep; ensure backendRef flow correct.
- `Session.introspect()` — returns `Promise<SessionIntrospection>` by reading `inputNames`/`outputNames` and optionally querying backend for shapes when available.
- `OnnxRuntime.loadModel(model, opts?)` — accept `LoadedModelOptions`, run optional warmup after load.
- `OnnxRuntime.shutdown(cache?)` — dispose underlying sessions tracked by runtime and clear optional cache.
- `SessionCache.size` — fix to return number (`entries.size` once Map reintroduced or cached count).
- `SessionCache.disposeAll()` — new method to dispose every cached session and clear storage.

[Classes]
Refine existing classes and add small helper classes.

- `InferenceSession` — genericize `InferenceOutput`, add retry wrapper with configurable delays, add multi-input helper.
- `Session` — add public `backendRef` typed as `OrtBackend`; add `introspect()` method.
- `SessionCache` — fix `size` getter, add `peek(key)` and `disposeAll()`, keep LRU semantics.
- `OnnxRuntime` — add `LoadedModelOptions` support in `loadModel`, add `shutdown()`.
- `CircuitBreaker` interface — keep minimal; document it's duck-typed for cockatiel compatibility.

[Dependencies]
No new runtime dependencies; package already peers on `onnxruntime-node` / `onnxruntime-web` and depends on `@org/types`.

- Ensure `peerDependencies` remain optional.
- No additional packages required.

[Testing]
Expand unit tests for new features without touching decision-engine.

- Add `packages/onnx-runtime/src/lib/inference.spec.ts` covering:
  - timeout path triggers fallback
  - circuit breaker integration via fake breaker
  - retry succeeds after transient failures
  - `predictFromArray` and `predictFromMap` produce correct feeds
  - `InferenceOutput` generic typing preserved for extra outputs
- Update `packages/onnx-runtime/src/lib/onnx-runtime.spec.ts` to cover:
  - `loadModel` options accepted
  - `shutdown` disposes tracked sessions
- Keep existing spec passing.

[Implementation Order]
Step-by-step sequence minimizing conflicts and ensuring compile/test verification at each stage.

1. Update `packages/onnx-runtime/src/types.ts` with new types (`InferenceOutput<T>`, `InferenceSessionOptions`, `LoadedModelOptions`, `SessionIntrospection`, `RuntimeShutdownResult`).
2. Modify `packages/onnx-runtime/src/lib/inference.ts` to generify `InferenceOutput`, add retry logic, add `predictFromMap`, and refine typing.
3. Modify `packages/onnx-runtime/src/lib/session.ts` to add `introspect()` and ensure stable `backendRef` typing.
4. Modify `packages/onnx-runtime/src/lib/onnx-runtime.ts` to extend `loadModel` with options and add `shutdown()`.
5. Fix `packages/onnx-runtime/src/lib/cache.ts` `size` getter and add `disposeAll()`.
6. Update exports in `packages/onnx-runtime/src/index.ts`.
7. Add/update tests in `inference.spec.ts` and `onnx-runtime.spec.ts`.
8. Add concise README section for new APIs.
9. Build and test with `npx nx build @org/onnx-runtime` and `npx nx test @org/onnx-runtime`, fix final issues.
10. Summarize migration notes for `apps/decision-engine` consumers (no code change there yet).