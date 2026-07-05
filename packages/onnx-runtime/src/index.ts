export { OnnxRuntime, type LoadedModel } from './lib/onnx-runtime'
export { Session } from './lib/session'
export { SessionCache } from './lib/cache'
export { DefaultProviderStrategy } from './lib/providers'
export { configureEnv } from './lib/env'

export {
  toTensor,
  fromTensor,
  toFloat32Tensor,
  toInt64Tensor,
} from './lib/tensor'

export {
  OrtWrapperError,
  ProviderUnavailableError,
  SessionCreationError,
  InferenceError,
  TensorShapeError,
  RuntimeMisconfiguredError,
} from './lib/errors'

export { InferenceSession } from './lib/inference'
export type {
  CircuitBreaker,
  InferenceCallbacks,
  InferenceOptions,
  SessionIntrospection,
  RuntimeShutdownResult,
} from './lib/inference'

export type {
  OrtBackend,
  RawSession,
  RawTensor,
  OrtEnv,
  TensorDtype,
  TensorData,
  ProviderName,
  ProviderConfig,
  ProviderStrategy,
  EnvConfig,
  RuntimeOptions,
  SessionOptions,
  Disposable,
  InferenceOutput,
} from './types'
