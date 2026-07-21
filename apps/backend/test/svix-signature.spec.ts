// The Resend webhook is unauthenticated by necessity, so this signature check
// is the only thing between the internet and email_log writes. Every rejection
// path is pinned here.
import { createHmac } from 'node:crypto';
import { verifySvixSignature } from 'src/utils/svix-signature';
import { describe, expect, it } from 'vitest';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const BODY = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc-123' } });

const sign = (rawBody: string, id: string, timestamp: string, secret = SECRET) => {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('verifySvixSignature', () => {
  it('accepts a correctly signed payload', () => {
    const ts = String(nowSeconds());
    const result = verifySvixSignature(BODY, { id: ID, timestamp: ts, signature: sign(BODY, ID, ts) }, SECRET);
    expect(result.valid).toBe(true);
  });

  it('accepts a bare secret without the whsec_ prefix', () => {
    const bare = SECRET.replace('whsec_', '');
    const ts = String(nowSeconds());
    const result = verifySvixSignature(BODY, { id: ID, timestamp: ts, signature: sign(BODY, ID, ts) }, bare);
    expect(result.valid).toBe(true);
  });

  it('accepts when one of several rotated signatures matches', () => {
    const ts = String(nowSeconds());
    const header = `v1,Zm9vYmFy ${sign(BODY, ID, ts)}`;
    expect(verifySvixSignature(BODY, { id: ID, timestamp: ts, signature: header }, SECRET).valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = String(nowSeconds());
    const signature = sign(BODY, ID, ts);
    const tampered = JSON.stringify({ type: 'email.delivered', data: { email_id: 'someone-elses-id' } });
    expect(verifySvixSignature(tampered, { id: ID, timestamp: ts, signature }, SECRET).valid).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const ts = String(nowSeconds());
    const signature = sign(BODY, ID, ts, 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(verifySvixSignature(BODY, { id: ID, timestamp: ts, signature }, SECRET).valid).toBe(false);
  });

  it('rejects a replayed request outside the tolerance window', () => {
    const old = String(nowSeconds() - 15 * 60);
    const result = verifySvixSignature(BODY, { id: ID, timestamp: old, signature: sign(BODY, ID, old) }, SECRET);
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('tolerance') });
  });

  it('rejects a timestamp far in the future', () => {
    const future = String(nowSeconds() + 15 * 60);
    const result = verifySvixSignature(BODY, { id: ID, timestamp: future, signature: sign(BODY, ID, future) }, SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects a signature bound to a different message id', () => {
    const ts = String(nowSeconds());
    const signature = sign(BODY, 'msg_other', ts);
    expect(verifySvixSignature(BODY, { id: ID, timestamp: ts, signature }, SECRET).valid).toBe(false);
  });

  it('rejects missing headers', () => {
    const ts = String(nowSeconds());
    expect(verifySvixSignature(BODY, {}, SECRET).valid).toBe(false);
    expect(verifySvixSignature(BODY, { id: ID, timestamp: ts }, SECRET).valid).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(
      verifySvixSignature(BODY, { id: ID, timestamp: 'not-a-number', signature: 'v1,x' }, SECRET).valid,
    ).toBe(false);
  });

  it('rejects an unversioned or malformed signature header', () => {
    const ts = String(nowSeconds());
    const raw = sign(BODY, ID, ts).replace('v1,', '');
    expect(verifySvixSignature(BODY, { id: ID, timestamp: ts, signature: raw }, SECRET).valid).toBe(false);
  });
});
