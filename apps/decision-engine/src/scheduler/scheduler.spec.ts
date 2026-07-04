import { describe, it, expect, vi } from 'vitest';
import { SchedulerService } from './scheduler.service.js';

function makeRedis() {
  const evalQueue = new Map<string, number>(); // sessionId → score
  const userSessions = new Map<number, Set<string>>(); // userId → sessionIds
  const keys = new Map<string, string>();

  const raw: Record<string, unknown> = {
    zadd: vi.fn(async (key: string, score: number, member: string) => {
      if (key === 'eval:queue') evalQueue.set(member, score);
      return 1;
    }),
    zrangebyscore: vi.fn(async (key: string, min: number, max: number, ...opts: unknown[]) => {
      if (key === 'eval:queue') {
        const now = Date.now();
        return [...evalQueue.entries()]
          .filter(([, s]) => s <= max && s >= min)
          .map(([id]) => id);
      }
      if (key.startsWith('user_sessions:')) {
        const uid = parseInt(key.split(':')[1]!, 10);
        return [...(userSessions.get(uid) ?? [])];
      }
      if (key.startsWith('eval:queue')) {
        return [...evalQueue.keys()];
      }
      return [];
    }),
    zrange: vi.fn(async (key: string) => {
      if (key.startsWith('user_sessions:')) {
        const uid = parseInt(key.split(':')[1]!, 10);
        return [...(userSessions.get(uid) ?? [])];
      }
      return [];
    }),
    zremrangebyscore: vi.fn(async (key: string, min: number, max: number) => {
      if (key === 'eval:queue') {
        let count = 0;
        for (const [id, score] of evalQueue.entries()) {
          if (score >= min && score <= max) { evalQueue.delete(id); count++; }
        }
        return count;
      }
      return 0;
    }),
    pipeline: vi.fn(() => {
      const ops: Array<() => void> = [];
      const pipe = {
        zrem: vi.fn(() => pipe),
        del: vi.fn(() => pipe),
        zremrangebyscore: vi.fn(() => pipe),
        exec: vi.fn(async () => []),
      };
      return pipe;
    }),
    _evalQueue: evalQueue,
    _userSessions: userSessions,
    _keys: keys,
  };

  return { getRedis: () => raw };
}

describe('SchedulerService', () => {
  describe('schedule', () => {
    it('adds session to eval:queue with correct delay for high score (0.5–0.6 → 30s)', async () => {
      const redis = makeRedis();
      const svc = new SchedulerService(redis as never);
      const before = Date.now();
      await svc.schedule('sid-1', 0.55);
      const raw = redis.getRedis();
      expect(raw.zadd).toHaveBeenCalledWith(
        'eval:queue',
        expect.any(Number),
        'sid-1',
      );
      const score = (raw.zadd as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
      expect(score).toBeGreaterThanOrEqual(before + 29_000);
      expect(score).toBeLessThanOrEqual(before + 31_000);
    });

    it('uses 2-minute delay for mid-range score (0.3–0.5)', async () => {
      const redis = makeRedis();
      const svc = new SchedulerService(redis as never);
      const before = Date.now();
      await svc.schedule('sid-1', 0.40);
      const score = ((redis.getRedis().zadd as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[1] as number;
      expect(score).toBeGreaterThanOrEqual(before + 119_000);
      expect(score).toBeLessThanOrEqual(before + 121_000);
    });

    it('uses 5-minute delay for low score (0.0–0.3)', async () => {
      const redis = makeRedis();
      const svc = new SchedulerService(redis as never);
      const before = Date.now();
      await svc.schedule('sid-1', 0.10);
      const score = ((redis.getRedis().zadd as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[1] as number;
      expect(score).toBeGreaterThanOrEqual(before + 299_000);
    });
  });

  describe('popDue', () => {
    it('returns empty array when no due entries exist', async () => {
      const redis = makeRedis();
      const svc = new SchedulerService(redis as never);
      const result = await svc.popDue();
      expect(result).toEqual([]);
    });
  });

  describe('clearUserSessions', () => {
    it('calls pipeline with del for risk and user_sessions keys', async () => {
      const redis = makeRedis();
      const svc = new SchedulerService(redis as never);
      // Should complete without throwing
      await expect(svc.clearUserSessions(42, 1)).resolves.toBeUndefined();
      const raw = redis.getRedis();
      expect(raw.zrange).toHaveBeenCalledWith('user_sessions:42', 0, -1);
      expect(raw.pipeline).toHaveBeenCalled();
    });
  });
});
