/**
 * Time-based one-time codes (RFC 6238), generated in the browser.
 *
 * 🔴 WHY THIS IS THE POINT OF THE WHOLE FEATURE. Storing a TOTP seed and handing
 * it over as `JBSWY3DPEHPK3PXP` is very nearly useless: the person receiving it
 * is not going to install an authenticator app and enrol a seed at the worst
 * moment of their life. What they need is the six digits, now. That is the
 * difference between a plan that works and a plan that only looks like it does.
 *
 * ⚠️ NO NEW DEPENDENCY, AND THAT IS DELIBERATE. WebCrypto already does
 * HMAC — the same `SubtleCrypto` the envelope encryption uses — and the seed is
 * already decrypted in the browser by the time this runs. Nothing here reaches
 * the network, and no secret crosses a module boundary that was not already
 * holding one.
 *
 * Feature: relay-h0-mvp
 */

export interface TotpParams {
  /** Base32, as it appears in an otpauth:// URI. */
  secret: string;
  issuer: string | null;
  account: string | null;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
}

export interface TotpCode {
  code: string;
  /** Seconds until this code expires. Drives the countdown. */
  secondsRemaining: number;
}

const DEFAULTS = { digits: 6, period: 30, algorithm: 'SHA-1' as const };

/**
 * RFC 4648 base32 decode, tolerant of what authenticator QR codes actually
 * contain: lowercase, spaces, and missing padding are all common in the wild.
 */
export function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;

  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`"${ch}" is not valid in a base32 secret`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Parses an `otpauth://totp/...` URI — what a QR code contains and what every
 * authenticator app offers as "can't scan it?" text.
 *
 * Returns null rather than throwing: this runs on owner input, and an
 * unparseable paste is a thing to explain, not an exception to catch.
 */
export function parseOtpauth(uri: string): TotpParams | null {
  const trimmed = uri.trim();

  /*
    A BARE BASE32 SECRET IS ACCEPTED TOO. Plenty of services print the seed
    without the URI wrapper, and an owner who pastes exactly what they were given
    should not have to know the difference. Checked before URL parsing because
    "JBSWY3DPEHPK3PXP" is not a URL.
  */
  if (!/^otpauth:/i.test(trimmed)) {
    if (/^[A-Za-z2-7\s-]+=*$/.test(trimmed) && trimmed.replace(/[\s-]/g, '').length >= 8) {
      return { secret: trimmed, issuer: null, account: null, ...DEFAULTS };
    }
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.host.toLowerCase() !== 'totp') return null; // hotp is counter-based, not time-based

  const secret = url.searchParams.get('secret');
  if (!secret) return null;
  try {
    base32Decode(secret);
  } catch {
    return null;
  }

  // Label is "Issuer:account" or just "account"; the issuer= parameter wins.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const [labelIssuer, labelAccount] = label.includes(':')
    ? [label.slice(0, label.indexOf(':')), label.slice(label.indexOf(':') + 1)]
    : [null, label];

  const digits = Number(url.searchParams.get('digits') ?? DEFAULTS.digits);
  const period = Number(url.searchParams.get('period') ?? DEFAULTS.period);
  const algParam = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  const algorithm =
    algParam === 'SHA256' || algParam === 'SHA-256'
      ? 'SHA-256'
      : algParam === 'SHA512' || algParam === 'SHA-512'
        ? 'SHA-512'
        : 'SHA-1';

  return {
    secret,
    issuer: url.searchParams.get('issuer') || labelIssuer || null,
    account: labelAccount ? labelAccount.trim() || null : null,
    // A malformed digits/period must not produce NaN codes on a screen someone
    // is relying on. Fall back rather than propagate.
    digits: Number.isFinite(digits) && digits >= 6 && digits <= 10 ? digits : DEFAULTS.digits,
    period: Number.isFinite(period) && period > 0 ? period : DEFAULTS.period,
    algorithm,
  };
}

/**
 * The code for a given instant.
 *
 * `nowMs` is a parameter rather than a `Date.now()` call so the RFC 6238 test
 * vectors can be checked exactly. Callers pass `Date.now()`.
 *
 * ⚠️ THE DEVICE CLOCK IS THE INPUT, and nobody can verify it here. A recipient
 * whose laptop clock is wrong gets codes that are silently rejected by the
 * service and will blame Relay. Q8 of the design QA. The countdown is shown so
 * that the failure at least has a visible cause.
 */
export async function generateTotp(params: TotpParams, nowMs: number): Promise<TotpCode> {
  const key = base32Decode(params.secret);
  const seconds = Math.floor(nowMs / 1000);
  const counter = Math.floor(seconds / params.period);

  // 8-byte big-endian counter. Written via two 32-bit halves because a JS
  // bitwise shift is 32-bit and would silently truncate.
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: params.algorithm },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf));

  // Dynamic truncation (RFC 4226 §5.3). The offset comes from the LAST byte, so
  // this is correct for SHA-256 and SHA-512 as well as SHA-1.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];

  const code = String(binary % 10 ** params.digits).padStart(params.digits, '0');
  return { code, secondsRemaining: params.period - (seconds % params.period) };
}
