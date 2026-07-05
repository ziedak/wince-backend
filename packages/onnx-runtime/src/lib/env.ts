import type { EnvConfig, OrtBackend } from '../types.js';

/**
 * Applies config to the *injected* backend's env object. Deliberately not a
 * module-level singleton — two Runtime instances in the same process (e.g.
 * one per model family) can carry different env settings without stepping
 * on each other.
 */
export function configureEnv(backend: OrtBackend, config: EnvConfig = {}): OrtBackend['env'] {
  if (config.logLevel) {
    backend.env.logLevel = config.logLevel;
  }
  if (config.wasm) {
    backend.env.wasm = { ...backend.env.wasm, ...config.wasm };
  }
  return backend.env;
}
