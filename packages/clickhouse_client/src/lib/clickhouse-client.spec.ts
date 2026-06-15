import { insert, query, healthCheck } from './clickhouse-client.js';

// @clickhouse/client is mocked to avoid a live server in unit tests.
vi.mock('@clickhouse/client', () => {
  const mockClient = {
    insert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue([{ col: 'val' }]),
    }),
    ping: vi.fn().mockResolvedValue({ success: true }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { createClient: vi.fn(() => mockClient) };
});

describe('insert', () => {
  it('is a no-op for empty rows', async () => {
    const { createClient } = await import('@clickhouse/client');
    const client = createClient({});
    await expect(insert(client, 'events', [])).resolves.toBeUndefined();
    expect(client.insert).not.toHaveBeenCalled();
  });

  it('calls client.insert for non-empty rows', async () => {
    const { createClient } = await import('@clickhouse/client');
    const client = createClient({});
    await insert(client, 'events', [{ eid: 'e1' }]);
    expect(client.insert).toHaveBeenCalledOnce();
  });
});

describe('query', () => {
  it('returns typed rows', async () => {
    const { createClient } = await import('@clickhouse/client');
    const client = createClient({});
    const rows = await query<{ col: string }>(client, 'SELECT 1');
    expect(rows).toEqual([{ col: 'val' }]);
  });
});

describe('healthCheck', () => {
  it('returns true when ping succeeds', async () => {
    const { createClient } = await import('@clickhouse/client');
    const client = createClient({});
    const healthy = await healthCheck(client);
    expect(healthy).toBe(true);
  });
});

