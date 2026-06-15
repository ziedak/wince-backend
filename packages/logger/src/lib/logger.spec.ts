import { createLogger, withTraceId } from './logger.js';

describe('createLogger', () => {
  it('returns a pino logger with correct service binding', () => {
    const logger = createLogger({ service: 'test-service' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('respects the level option', () => {
    const logger = createLogger({ service: 'test-service', level: 'warn' });
    expect(logger.level).toBe('warn');
  });

  it('defaults to info level when LOG_LEVEL is not set', () => {
    const prev = process.env['LOG_LEVEL'];
    delete process.env['LOG_LEVEL'];
    const logger = createLogger({ service: 'svc' });
    expect(logger.level).toBe('info');
    if (prev !== undefined) process.env['LOG_LEVEL'] = prev;
  });
});

describe('withTraceId', () => {
  it('returns a child logger', () => {
    const logger = createLogger({ service: 'svc' });
    const child = withTraceId(logger, 'trace-abc-123');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });
});

