import { query, transaction, healthCheck } from './postgre-client.js';

// pg Pool is mocked to avoid a live database in unit tests.
vi.mock('pg', () => {
  const release = vi.fn();
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release,
  };
  function Pool() {
    this.query = vi.fn().mockResolvedValue({ rows: [{ result: 1 }] });
    this.connect = vi.fn().mockResolvedValue(mockClient);
  }
  return { Pool };
});

describe('query', () => {
  it('returns rows from the pool', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const rows = await query(pool, 'SELECT 1 AS result');
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('transaction', () => {
  it('runs the callback and commits', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const result = await transaction(pool, async () => 'done');
    expect(result).toBe('done');
  });
});

describe('healthCheck', () => {
  it('returns true when pool responds', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const healthy = await healthCheck(pool);
    expect(healthy).toBe(true);
  });
});

