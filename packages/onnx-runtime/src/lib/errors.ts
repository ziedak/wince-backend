export type ErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'SESSION_CREATION_FAILED'
  | 'SESSION_DISPOSED'
  | 'INFERENCE_FAILED'
  | 'TENSOR_SHAPE_MISMATCH'
  | 'RUNTIME_MISCONFIGURED';

export class OrtWrapperError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: ErrorCode, cause?: unknown) {
    super(message);
    this.name = 'OrtWrapperError';
    this.code = code;
    this.cause = cause;
  }
}

export class ProviderUnavailableError extends OrtWrapperError {
  constructor(requested: string[], cause?: unknown) {
    super(
      `None of the requested execution providers are available: [${requested.join(', ')}]`,
      'PROVIDER_UNAVAILABLE',
      cause
    );
    this.name = 'ProviderUnavailableError';
  }
}

export class SessionCreationError extends OrtWrapperError {
  constructor(message: string, cause?: unknown) {
    super(message, 'SESSION_CREATION_FAILED', cause);
    this.name = 'SessionCreationError';
  }
}

export class InferenceError extends OrtWrapperError {
  constructor(message: string, cause?: unknown) {
    super(message, 'INFERENCE_FAILED', cause);
    this.name = 'InferenceError';
  }
}

export class TensorShapeError extends OrtWrapperError {
  constructor(expected: number, actual: number, dims: number[]) {
    super(
      `Tensor data length ${actual} does not match dims [${dims.join(',')}] (expected ${expected})`,
      'TENSOR_SHAPE_MISMATCH'
    );
    this.name = 'TensorShapeError';
  }
}

export class RuntimeMisconfiguredError extends OrtWrapperError {
  constructor(message: string) {
    super(message, 'RUNTIME_MISCONFIGURED');
    this.name = 'RuntimeMisconfiguredError';
  }
}
