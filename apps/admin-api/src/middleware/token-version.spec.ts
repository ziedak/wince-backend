import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, generateKeyPair, exportSPKI } from 'jose';
import { tokenVersionGuard } from '../middleware/token-version';
import type { AuthUser } from '../middleware/auth';

let privateKey: CryptoKey;
let publicKeyPem: string;

beforeEach(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  publicKeyPem = await exportSPKI(pair.publicKey);
});

async function makeToken(tokenVersion: number): Promise<string> {
  return new SignJWT({ token_version: tokenVersion })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setExpirationTime('1h')
    .sign(privateKey);
}

function makeApp(dbTokenVersion: number, jwtTokenVersion: number) {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ tokenVersion: dbTokenVersion }]),
  };

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', { userId: 1, roles: ['admin'], storeIds: [10] } satisfies AuthUser);
    await next();
  });
  app.get('/test', tokenVersionGuard(mockDb as never, publicKeyPem), (c) => c.json({ ok: true }));
  return app;
}

describe('tokenVersionGuard', () => {
  it('allows when JWT token_version matches DB', async () => {
    const token = await makeToken(3);
    const app = makeApp(3, 3);
    const res = await app.request('/test', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it('returns 401 when token_version is stale', async () => {
    const token = await makeToken(1);
    const app = makeApp(5, 1); // DB has version 5, JWT has 1
    const res = await app.request('/test', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Token has been revoked');
  });

  it('returns 401 when no Authorization header', async () => {
    const app = makeApp(1, 1);
    const res = await app.request('/test');
    expect(res.status).toBe(401);
  });
});
