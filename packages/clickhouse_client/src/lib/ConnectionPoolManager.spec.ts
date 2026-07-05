import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@org/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({})),
}));

import {
  ClickHouseConnectionPoolManager,
  PooledClickHouseConnection,
} from './ConnectionPoolManager.js';

function createFakeClient() {
  return {
    disconnect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(true),
    healthCheck: vi.fn().mockResolvedValue({ status: 'healthy' }),
    isHealthy: vi.fn().mockReturnValue(true),
    execute: vi.fn(),
    insert: vi.fn(),
    batchInsert: vi.fn(),
    arrayOperations: {},
    aggregations: {},
    timeSeries: {},
    sampling: {},
  };
}

function createPoolManager(config?: Partial<ConstructorParameters<typeof ClickHouseConnectionPoolManager>[0]>) {
  const manager = new ClickHouseConnectionPoolManager({
    minConnections: 0,
    maxConnections: 1,
    connectionTimeout: 25,
    idleTimeout: 0,
    healthCheckInterval: 1_000,
    acquireTimeout: 25,
    enableCircuitBreaker: false,
    circuitBreakerThreshold: 1,
    retryAttempts: 0,
    retryDelay: 0,
    ...config,
  });

  const createdClients: Array<ReturnType<typeof createFakeClient>> = [];

  (manager as any).createConnection = vi.fn(async () => {
    const client = createFakeClient();
    createdClients.push(client);
    return new PooledClickHouseConnection(client as any, manager as any);
  });

  return { manager, createdClients };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClickHouseConnectionPoolManager', () => {
  it('does not hand out the same connection twice while it is checked out', async () => {
    const { manager } = createPoolManager({
      minConnections: 1,
      idleTimeout: 1_000,
    });

    await manager.initialize();

    const first = await manager.acquireConnection();
    const secondAcquire = manager.acquireConnection();

    let resolvedEarly = false;
    secondAcquire.then(() => {
      resolvedEarly = true;
    });

    await Promise.resolve();

    expect(resolvedEarly).toBe(false);
    expect(manager.getPoolStats()).toMatchObject({
      totalConnections: 1,
      activeConnections: 1,
      idleConnections: 0,
      pendingAcquires: 1,
    });

    await (manager as any).releaseConnection(first);

    const second = await secondAcquire;

    expect(second).toBe(first);
    expect(manager.getPoolStats()).toMatchObject({
      totalConnections: 1,
      activeConnections: 1,
      idleConnections: 0,
      pendingAcquires: 0,
    });

    await (manager as any).releaseConnection(second);

    expect(manager.getPoolStats()).toMatchObject({
      totalConnections: 1,
      activeConnections: 0,
      idleConnections: 1,
      pendingAcquires: 0,
    });
  });

  it('removes excess connections from the pool when they are closed', async () => {
    const { manager, createdClients } = createPoolManager({ minConnections: 0 });

    await manager.initialize();

    const connection = await manager.acquireConnection();
    const client = createdClients[0];

    expect(client).toBeDefined();

    await (manager as any).releaseConnection(connection);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(manager.getPoolStats()).toMatchObject({
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      pendingAcquires: 0,
    });
  });
});