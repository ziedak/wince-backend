import { bfExists, bfAdd, get, set, hset, hgetall } from './redis-client.js';

// Unit tests using a minimal Redis mock — no live server required.
const makeMockRedis = () => {
  const store = new Map<string, string>();
  const hstore = new Map<string, Map<string, string>>();
  return {
    _store: store,
    call: vi.fn(async (cmd: string, key: string, item: string) => {
      if (cmd === 'BF.EXISTS') return store.has(`bf:${key}:${item}`) ? 1 : 0;
      if (cmd === 'BF.ADD') {
        const k = `bf:${key}:${item}`;
        const existed = store.has(k);
        store.set(k, '1');
        return existed ? 0 : 1;
      }
      return null;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, val: string) => { store.set(key, val); return 'OK'; }),
    hset: vi.fn(async (key: string, ...args: string[]) => {
      const m = hstore.get(key) ?? new Map<string, string>();
      for (let i = 0; i < args.length; i += 2) {
        const k = args[i];
        const v = args[i + 1];
        if (k !== undefined && v !== undefined) m.set(k, v);
      }
      hstore.set(key, m);
      return args.length / 2;
    }),
    hgetall: vi.fn(async (key: string) => {
      const m = hstore.get(key);
      if (!m) return {};
      return Object.fromEntries(m.entries());
    }),
    expire: vi.fn(async () => 1),
  };
};

describe('bfExists / bfAdd', () => {
  it('returns false for a new item', async () => {
    const redis = makeMockRedis();
    const exists = await bfExists(redis as never, 'idem:bloom', 'eid-1');
    expect(exists).toBe(false);
  });

  it('returns true after bfAdd', async () => {
    const redis = makeMockRedis();
    await bfAdd(redis as never, 'idem:bloom', 'eid-1');
    const exists = await bfExists(redis as never, 'idem:bloom', 'eid-1');
    expect(exists).toBe(true);
  });

  it('bfAdd returns true for a new item', async () => {
    const redis = makeMockRedis();
    const added = await bfAdd(redis as never, 'idem:bloom', 'eid-new');
    expect(added).toBe(true);
  });
});

describe('get / set', () => {
  it('returns null for missing keys', async () => {
    const redis = makeMockRedis();
    const val = await get<{ foo: string }>(redis as never, 'missing');
    expect(val).toBeNull();
  });

  it('round-trips JSON values', async () => {
    const redis = makeMockRedis();
    await set(redis as never, 'my-key', { foo: 'bar' });
    const val = await get<{ foo: string }>(redis as never, 'my-key');
    expect(val?.foo).toBe('bar');
  });
});

describe('hset / hgetall', () => {
  it('stores and retrieves hash fields', async () => {
    const redis = makeMockRedis();
    await hset(redis as never, 'session:abc', { cart_value: 99, rage_click_count: 2 });
    const result = await hgetall<{ cart_value: string }>(redis as never, 'session:abc');
    expect(result).not.toBeNull();
  });

  it('returns null for missing hash', async () => {
    const redis = makeMockRedis();
    const result = await hgetall(redis as never, 'missing');
    expect(result).toBeNull();
  });
});

