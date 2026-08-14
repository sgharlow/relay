/**
 * The webhook's only credential.
 *
 * This endpoint is unauthenticated by necessity — the caller is Resend, which
 * holds no session — so the signature IS the authentication. If it can be
 * forged, anyone can write "bounced" against any address and make an owner
 * believe their verifier is unreachable, or write "delivered" and hide a real
 * bounce. The second is worse: it manufactures a false green on the exact
 * screen built to remove one.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifySvixSignature, TOLERANCE_SECONDS } from './svix-signature';

const KEY = Buffer.from('a-test-signing-key-that-is-long-enough');
const SECRET = `whsec_${KEY.toString('base64')}`;
const ID = 'msg_2abc';
const BODY = '{"type":"email.bounced","data":{"to":["a@b.com"]}}';

function sign(body: string, id: string, ts: number, key: Buffer = KEY): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

const now = 1_800_000_000;

describe('verifySvixSignature', () => {
  it('accepts a correctly signed, in-window message', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        rawBody: BODY,
        headers: { id: ID, timestamp: String(now), signature: sign(BODY, ID, now) },
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects a body that changed by one byte', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        rawBody: BODY.replace('bounced', 'delivered'),
        headers: { id: ID, timestamp: String(now), signature: sign(BODY, ID, now) },
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const other = Buffer.from('a-completely-different-signing-key!!');
    expect(
      verifySvixSignature({
        secret: SECRET,
        rawBody: BODY,
        headers: { id: ID, timestamp: String(now), signature: sign(BODY, ID, now, other) },
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a replay outside the window, in both directions', () => {
    const stale = now - TOLERANCE_SECONDS - 1;
    const future = now + TOLERANCE_SECONDS + 1;
    for (const ts of [stale, future]) {
      expect(
        verifySvixSignature({
          secret: SECRET,
          rawBody: BODY,
          headers: { id: ID, timestamp: String(ts), signature: sign(BODY, ID, ts) },
          nowSeconds: now,
        }),
      ).toBe(false);
    }
  });

  it('binds the signature to the message id — a valid signature for another id fails', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        rawBody: BODY,
        headers: { id: 'msg_different', timestamp: String(now), signature: sign(BODY, ID, now) },
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  /*
    Svix sends every ACTIVE secret's signature during a rotation, space
    separated. Requiring the first to match would break precisely when a
    rotation is in flight — the moment least convenient to debug.
  */
  it('accepts when any listed signature matches, not only the first', () => {
    const wrong = sign(BODY, ID, now, Buffer.from('another-key-entirely-here!'));
    expect(
      verifySvixSignature({
        secret: SECRET,
        rawBody: BODY,
        headers: {
          id: ID,
          timestamp: String(now),
          signature: `${wrong} ${sign(BODY, ID, now)}`,
        },
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('refuses anything missing, rather than defaulting to trust', () => {
    const good = { id: ID, timestamp: String(now), signature: sign(BODY, ID, now) };
    for (const missing of ['id', 'timestamp', 'signature'] as const) {
      expect(
        verifySvixSignature({
          secret: SECRET,
          rawBody: BODY,
          headers: { ...good, [missing]: null },
          nowSeconds: now,
        }),
      ).toBe(false);
    }
    // No secret configured is the unconfigured case, and it must fail closed.
    expect(
      verifySvixSignature({ secret: '', rawBody: BODY, headers: good, nowSeconds: now }),
    ).toBe(false);
  });

  it('rejects a non-numeric timestamp instead of coercing it', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        rawBody: BODY,
        headers: { id: ID, timestamp: 'not-a-time', signature: sign(BODY, ID, now) },
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
