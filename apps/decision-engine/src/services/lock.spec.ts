import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LockService } from './lock.service.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRedis(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const redis = {
    eval: vi.fn(async (script: string, _numKeys: number, key: string, ...args: string[]) => {
      if (script.includes('NX')) {
        // ACQUIRE: set NX
        const token = args[0]!;
        if (store.has(key)) return '';
        store.set(key, token);
        return token;
      }
      if (script.includes('expire')) {
        // RENEW: check token then expire
        const token = args[0]!;
        if (store.get(key) === token) return 1;
        return 0;
      }
      if (script.includes('del')) {
        // RELEASE: check token then del
        const token = args[0]!;
        if (store.get(key) === token) { store.delete(key); return 1; }
        return 0;
      }
      return null;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, val: string) => { store.set(key, val); return 'OK'; }),
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    _store: store,
    ...overrides,
  };
  return { getRedis: () => redis };
}

function makeMetrics() {
  return { lockAcquireFailed: vi.fn() };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LockService', () => {
  describe('acquireUserLock', () => {
    it('returns a fencing token when the lock is free', async () => {
      const svc = new LockService(makeRedis() as never, makeMetrics() as never);
      const token = await svc.acquireUserLock(1);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    it('returns null when the lock is already held', async () => {
      const redis = makeRedis();
      const svc = new LockService(redis as never, makeMetrics() as never);
      const first = await svc.acquireUserLock(1);
      expect(first).toBeTruthy();
      const second = await svc.acquireUserLock(1);
      expect(second).toBeNull();
    });

    it('returns different tokens for different users', async () => {
      const svc = new LockService(makeRedis() as never, makeMetrics() as never);
      const t1 = await svc.acquireUserLock(1);
      const t2 = await svc.acquireUserLock(2);
      expect(t1).not.toBe(t2);
      expect(t1).toBeTruthy();
      expect(t2).toBeTruthy();
    });

    it('fails open (returns a token) on Redis error', async () => {
      const redis = makeRedis({ eval: vi.fn().mockRejectedValue(new Error('Redis down')) });
      const metrics = makeMetrics();
      const svc = new LockService(redis as never, metrics as never);
      const token = await svc.acquireUserLock(1);
      expect(token).toBeTruthy();
      expect(metrics.lockAcquireFailed).toHaveBeenCalledWith('user');
    });
  });

  describe('renewUserLock (fencing check)', () => {
    it('returns true when token still matches', async () => {
      const svc = new LockService(makeRedis() as never, makeMetrics() as never);
      const token = await svc.acquireUserLock(1);
      const renewed = await svc.renewUserLock(1, token!);
      expect(renewed).toBe(true);
    });

    it('returns false when lock was taken by a different holder (stale holder detection)', async () => {
      const redis = makeRedis();
      const svc = new LockService(redis as never, makeMetrics() as never);
      await svc.acquireUserLock(1);
      // Simulate stale holder: different token
      const renewed = await svc.renewUserLock(1, 'stale-token-xyz');
      expect(renewed).toBe(false);
    });
  });

  describe('releaseUserLock', () => {
    it('releases the lock so another caller can acquire it', async () => {
      const redis = makeRedis();
      const svc = new LockService(redis as never, makeMetrics() as never);
      const token = await svc.acquireUserLock(1);
      await svc.releaseUserLock(1, token!);
      // Now another caller should be able to acquire
      const newToken = await svc.acquireUserLock(1);
      expect(newToken).toBeTruthy();
    });

    it('is a no-op when token does not match (prevents releasing another holder)', async () => {
      const redis = makeRedis();
      const svc = new LockService(redis as never, makeMetrics() as never);
      const realToken = await svc.acquireUserLock(1);
      // Stale holder tries to release with wrong token
      await svc.releaseUserLock(1, 'wrong-token');
      // Real holder's lock should still be in place
      const tryAcquire = await svc.acquireUserLock(1);
      expect(tryAcquire).toBeNull();
      // Real holder can still release
      await svc.releaseUserLock(1, realToken!);
    });
  });

  describe('isSent / markSent / clearUserSent', () => {
    it('isSent returns false before markSent', async () => {
      const svc = new LockService(makeRedis() as never, makeMetrics() as never);
      expect(await svc.isSent(42)).toBe(false);
    });

    it('isSent returns true after markSent', async () => {
      const svc = new LockService(makeRedis() as never, makeMetrics() as never);
      await svc.markSent(42);
      expect(await svc.isSent(42)).toBe(true);
    });

    it('clearUserSent removes the marker', async () => {
      const svc = new LockService(makeRedis() as never, makeMetrics() as never);
      await svc.markSent(42);
      await svc.clearUserSent(42);
      expect(await svc.isSent(42)).toBe(false);
    });

    it('isSent fails open (returns false) on Redis error', async () => {
      const redis = makeRedis({ get: vi.fn().mockRejectedValue(new Error('Redis error')) });
      const svc = new LockService(redis as never, makeMetrics() as never);
      expect(await svc.isSent(1)).toBe(false);
    });
  });
});
