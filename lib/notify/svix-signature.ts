/**
 * Svix webhook signature verification, without the dependency.
 *
 * Resend signs webhooks with Svix. The scheme is small and fully specified, and
 * this repo already owns a timing-safe compare — so verifying it here costs
 * ~30 lines and avoids adding a package to a product days before a beta.
 *
 * THE SCHEME:
 *   secret      "whsec_<base64>"; the bytes after the prefix are the HMAC key
 *   signed      `${svix-id}.${svix-timestamp}.${rawBody}`
 *   header      `svix-signature: v1,<b64> v1,<b64> …`  (space-separated,
 *               multiple because secrets rotate — ANY match is valid)
 *
 * ⚠️ THE RAW BODY IS THE MESSAGE. Re-serialising parsed JSON changes bytes
 * (key order, whitespace, unicode escapes) and the signature stops matching for
 * reasons nobody can see. The caller must pass exactly what arrived.
 *
 * Feature: relay-h0-mvp
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Replay window. Svix's own guidance is five minutes either side. */
export const TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * True IFF the signature is valid and the timestamp is inside the window.
 *
 * Returns a boolean rather than throwing: the caller answers a constant 204 to
 * everything, and a verifier that distinguishes its failures by exception type
 * invites a caller to learn from them.
 */
export function verifySvixSignature(params: {
  secret: string;
  rawBody: string;
  headers: SvixHeaders;
  nowSeconds?: number;
}): boolean {
  const { secret, rawBody, headers } = params;
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;

  // Timestamp must be a number inside the tolerance, or an old capture replays.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const keyB64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();

  /*
    ANY listed signature may match: Svix sends every active secret during a
    rotation, so requiring the first would break exactly when a rotation is in
    flight. Each candidate is compared in constant time and length-checked
    first, because timingSafeEqual throws on a length mismatch.
  */
  for (const part of signature.split(' ')) {
    const [version, b64] = part.split(',');
    if (version !== 'v1' || !b64) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(b64, 'base64');
    } catch {
      continue;
    }
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}
