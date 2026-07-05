import type { OrtBackend, RawTensor, TensorData, TensorDtype } from '../types'
import { TensorShapeError } from './errors'

function expectedLength(dims: number[]): number {
  return dims.reduce((a, b) => a * b, 1)
}

function validateShape(data: TensorData, dims: number[]): void {
  const expected = expectedLength(dims)
  const actual = Array.isArray(data) ? data.length : data.length
  if (actual !== expected) {
    throw new TensorShapeError(expected, actual, dims)
  }
}

export function toTensor(
  backend: OrtBackend,
  data: TensorData,
  dims: number[],
  dtype: TensorDtype = 'float32'
): RawTensor {
  validateShape(data, dims)
  return new backend.Tensor(dtype, data, dims)
}

export function fromTensor(tensor: RawTensor): {
  data: TensorData
  dims: number[]
  type: TensorDtype
} {
  return { data: tensor.data, dims: tensor.dims, type: tensor.type }
}

/** Convenience for the common float32 case. */
export function toFloat32Tensor(
  backend: OrtBackend,
  data: number[] | Float32Array,
  dims: number[]
): RawTensor {
  const typed = data instanceof Float32Array ? data : Float32Array.from(data)
  return toTensor(backend, typed, dims, 'float32')
}

/** Convenience for int64 (common for token ids / indices). */
export function toInt64Tensor(
  backend: OrtBackend,
  data: number[] | bigint[] | BigInt64Array,
  dims: number[]
): RawTensor {
  const typed =
    data instanceof BigInt64Array
      ? data
      : BigInt64Array.from(data as (number | bigint)[], (v) => BigInt(v))
  return toTensor(backend, typed, dims, 'int64')
}
