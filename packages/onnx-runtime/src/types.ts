/**
 * The wrapper never imports onnxruntime-web / onnxruntime-node directly.
 * Callers inject whichever build they need, which is what makes the same
 * package work in both Node and the browser (and keeps bundlers happy).
 */
export interface OrtBackend {
  InferenceSession: {
    create: (
      model: string | ArrayBuffer | ArrayBufferLike | Uint8Array,
      options?: Record<string, unknown>
    ) => Promise<RawSession>;
  };
  Tensor: {
    new (type: TensorDtype, data: TensorData, dims: number[]): RawTensor;
    (type: TensorDtype, data: TensorData, dims: number[]): RawTensor;
  };
  env: OrtEnv;
}

export interface RawSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run: (feeds: Record<string, RawTensor>) => Promise<Record<string, RawTensor>>;
  release?: () => Promise<void>;
}

export interface RawTensor {
  type: TensorDtype;
  data: TensorData;
  dims: number[];
}

export interface OrtEnv {
  logLevel?: string;
  wasm?: { wasmPaths?: string; numThreads?: number; simd?: boolean };
  [key: string]: unknown;
}

export type TensorDtype =
  | 'float32'
  | 'float64'
  | 'int32'
  | 'int64'
  | 'uint8'
  | 'bool'
  | 'string';

export type TensorData =
  | Float32Array
  | Float64Array
  | Int32Array
  | BigInt64Array
  | Uint8Array
  | string[];

export type ProviderName =
  | 'webgpu'
  | 'webgl'
  | 'wasm'
  | 'cpu'
  | 'cuda'
  | 'coreml'
  | 'dml';

export interface ProviderConfig {
  name: ProviderName;
  options?: Record<string, unknown>;
}

export interface ProviderStrategy {
  /** Filters a requested provider list down to what's actually usable, in priority order. */
  resolve(requested: ProviderConfig[]): Promise<ProviderConfig[]>;
}

export interface EnvConfig {
  logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
  wasm?: { wasmPaths?: string; numThreads?: number; simd?: boolean };
}

export interface RuntimeOptions {
  backend: OrtBackend;
  env?: EnvConfig;
  providerStrategy?: ProviderStrategy;
}

export interface SessionOptions {
  providers?: ProviderConfig[];
  sessionOptions?: Record<string, unknown>;
}

export interface LoadedModelOptions extends SessionOptions {
  /** Run a warmup inference after model load. Can be a boolean or a custom async function. */
  warmup?: boolean | (() => Promise<void>);
}

export interface InferenceOptions {
  /** Hard timeout for each inference call. Default: 50ms. */
  timeoutMs?: number;
  /** Optional circuit breaker. When absent, timeout and fallback still apply. */
  circuitBreaker?: CircuitBreaker;
  /** Observability hooks. */
  callbacks?: InferenceCallbacks;
  /** Optional retry with backoff. When absent, no retries. */
  retry?: {
    /** Total attempts including the first call. */
    attempts: number;
    /** Delay between retries in ms. */
    delaysMs: number[];
  };
  /** Optional warmup hook executed on first successful inference. */
  warmup?: boolean | (() => Promise<void>);
}

export interface InferenceCallbacks {
  /** Called after every successful or failed inference with elapsed ms. */
  onDuration?(ms: number): void;
  /** Called when inference falls back (timeout, runtime error, etc.). */
  onFallback?(): void;
  /** Called when circuit breaker transitions to open. */
  onCircuitOpen?(): void;
  /** Called when circuit breaker resets to closed. */
  onCircuitClosed?(): void;
}

export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  onBreak?(callback: () => void): void;
  onReset?(callback: () => void): void;
}

/** Preserves tensor types for extra model outputs beyond `confidence`. */
export interface InferenceOutput {
  confidence: number;
  [key: string]: TensorData | number;
}

export interface SessionIntrospection {
  inputMeta: Array<{ name: string; dtype: TensorDtype; dims: number[] }>;
  outputMeta: Array<{ name: string; dtype: TensorDtype; dims: number[] }>;
}

export interface RuntimeShutdownResult {
  sessionsDisposed: number;
  cacheCleared: boolean;
}

export interface Disposable {
  dispose(): Promise<void>;
}
