import { describe, it, expect } from 'vitest';
import { SignJWT, jwtVerify, generateKeyPair, importSPKI, importPKCS8, exportSPKI, exportPKCS8 } from 'jose';

describe('RS256 JWT sign + verify round-trip', () => {
  it('issues and verifies a token with correct claims', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({
      email: 'test@example.com',
      roles: ['admin'],
      store_ids: [1, 2],
      token_version: 3,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('42')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const { payload } = await jwtVerify(token, publicKey);

    expect(payload.sub).toBe('42');
    expect(payload['email']).toBe('test@example.com');
    expect(payload['roles']).toEqual(['admin']);
    expect(payload['store_ids']).toEqual([1, 2]);
    expect(payload['token_version']).toBe(3);
  });

  it('rejects a token signed with a different key', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const { publicKey: wrongPublicKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({ test: true })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(jwtVerify(token, wrongPublicKey)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');

    const token = await new SignJWT({ test: true })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('-1s') // already expired
      .sign(privateKey);

    await expect(jwtVerify(token, publicKey)).rejects.toThrow(/exp/i);
  });

  it('base64-encodes private key and round-trips via importPKCS8 / importSPKI', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');

    // Simulate how config.ts stores/loads them — use jose's exportPKCS8/exportSPKI
    const privPem = await exportPKCS8(privateKey);
    const pubPem = await exportSPKI(publicKey);
    // base64 round-trip (as used in config.ts)
    const privB64 = Buffer.from(privPem).toString('base64');
    const pubB64 = Buffer.from(pubPem).toString('base64');
    const decodedPrivPem = Buffer.from(privB64, 'base64').toString('utf-8');
    const decodedPubPem = Buffer.from(pubB64, 'base64').toString('utf-8');

    const loadedPriv = await importPKCS8(decodedPrivPem, 'RS256');
    const loadedPub = await importSPKI(decodedPubPem, 'RS256');

    const token = await new SignJWT({ ok: true }).setProtectedHeader({ alg: 'RS256' }).setExpirationTime('1h').sign(loadedPriv);
    const { payload } = await jwtVerify(token, loadedPub);
    expect(payload['ok']).toBe(true);
  });
});
