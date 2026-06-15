import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

export interface LoggerOptions {
  service: string;
  /** Optional fixed store_id to bind to every log line */
  store_id?: number;
  /** Log level — defaults to LOG_LEVEL env var or 'info' */
  level?: string;
}

/**
 * Creates a structured pino logger bound to a service name.
 * Every log line includes `service`, `trace_id` (if provided via child()),
 * and optionally `store_id`.
 */
export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? process.env['LOG_LEVEL'] ?? 'info';

  const bindings: Record<string, unknown> = { service: options.service };
  if (options.store_id !== undefined) {
    bindings['store_id'] = options.store_id;
  }

  return pino({
    level,
    base: bindings,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

/**
 * Returns a child logger with a trace_id bound.
 * Use at the request boundary to propagate a trace through log lines.
 */
export function withTraceId(logger: Logger, traceId: string): Logger {
  return logger.child({ trace_id: traceId });
}

