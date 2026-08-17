/**
 * TOTP, checked against the vectors published in RFC 6238 Appendix B.
 *
 * These are the reference values, not values I computed from my own
 * implementation and then asserted — which would only prove the code agrees with
 * itself. If the base32 decode, the counter packing, the HMAC or the dynamic
 * truncation is wrong, these fail.
 *
 * The RFC's seed is the ASCII string "12345678901234567890" (20 bytes), whose
 * base32 encoding is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ. The published codes are
 * 8 digits.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { generateTotp, parseOtpauth, base32Decode, type TotpParams } from './totp';

const RFC_SECRET_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function params(over: Partial<TotpParams> = {}): TotpParams {
  return {
    secret: RFC_SECRET_SHA1,
    issuer: null,
    account: null,
    digits: 8,
    period: 30,
    algorithm: 'SHA-1',
    ...over,
  };
}

describe('RFC 6238 Appendix B test vectors (SHA-1)', () => {
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vectors)('T=%i produces %s', async (unixSeconds, expected) => {
    const { code } = await generateTotp(params(), unixSeconds * 1000);
    expect(code).toBe(expected);
  });

  it('uses the high half of the 64-bit counter — no RFC vector reaches it', async () => {
    /*
      ⚠️ NONE OF THE PUBLISHED VECTORS TEST THIS. The largest, T=20000000000,
      gives a counter of 666,666,666 — comfortably inside 32 bits. The counter
      only passes 2^32 after about 4,000 years, so every vector above would still
      pass on an implementation that silently truncated it.

      The packing is still written as two 32-bit halves because that is what the
      spec says, and a lone `<< 32` in JavaScript is a 32-bit operation that
      wraps to zero. This is the test that actually exercises it: two instants
      whose counters differ by EXACTLY 2^32. A truncating implementation maps
      both to the same counter and returns the same code.
    */
    const lowCounter = 1;
    const highCounter = lowCounter + 0x100000000;
    const low = await generateTotp(params(), lowCounter * 30 * 1000);
    const high = await generateTotp(params(), highCounter * 30 * 1000);
    expect(high.code).not.toBe(low.code);
  });
});

describe('base32Decode', () => {
  it('decodes the RFC seed back to its ASCII bytes', () => {
    const bytes = base32Decode(RFC_SECRET_SHA1);
    expect(new TextDecoder().decode(bytes)).toBe('12345678901234567890');
  });

  it('tolerates what QR codes and printed seeds actually contain', () => {
    // Lowercase, spaces, hyphens and missing padding are all common.
    const canonical = base32Decode('JBSWY3DPEHPK3PXP');
    expect(base32Decode('jbswy3dpehpk3pxp')).toEqual(canonical);
    expect(base32Decode('JBSW Y3DP EHPK 3PXP')).toEqual(canonical);
    expect(base32Decode('JBSW-Y3DP-EHPK-3PXP')).toEqual(canonical);
    expect(base32Decode('JBSWY3DPEHPK3PXP===')).toEqual(canonical);
  });

  it('refuses a character that is not in the alphabet, naming it', () => {
    // 0, 1 and 8 are deliberately absent from base32 — they are the characters
    // people mistype for O, I and B when copying a seed by hand.
    expect(() => base32Decode('JBSW0Y3DP')).toThrow(/"0"/);
  });
});

describe('the countdown', () => {
  it('reports the seconds left in the current window', async () => {
    expect((await generateTotp(params(), 0)).secondsRemaining).toBe(30);
    expect((await generateTotp(params(), 1_000)).secondsRemaining).toBe(29);
    expect((await generateTotp(params(), 29_000)).secondsRemaining).toBe(1);
    expect((await generateTotp(params(), 30_000)).secondsRemaining).toBe(30);
  });

  it('holds the same code for the whole window and changes at the boundary', async () => {
    const at = async (ms: number) => (await generateTotp(params(), ms)).code;
    expect(await at(30_000)).toBe(await at(59_999));
    expect(await at(59_999)).not.toBe(await at(60_000));
  });
});

describe('parseOtpauth', () => {
  it('reads a standard authenticator URI', () => {
    const p = parseOtpauth('otpauth://totp/Google:steve@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Google');
    expect(p).toMatchObject({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'Google',
      account: 'steve@example.com',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1',
    });
  });

  it('takes the issuer from the label when there is no issuer parameter', () => {
    expect(parseOtpauth('otpauth://totp/GitHub:steve?secret=JBSWY3DPEHPK3PXP')?.issuer).toBe('GitHub');
  });

  it('honours non-default digits, period and algorithm', () => {
    const p = parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256');
    expect(p).toMatchObject({ digits: 8, period: 60, algorithm: 'SHA-256' });
  });

  it('accepts a bare base32 seed, because plenty of services print only that', () => {
    // An owner pasting exactly what they were given should not have to know the
    // difference between a seed and a URI.
    expect(parseOtpauth('JBSWY3DPEHPK3PXP')).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP', digits: 6 });
    expect(parseOtpauth('  jbsw y3dp ehpk 3pxp  ')?.secret.trim()).toBe('jbsw y3dp ehpk 3pxp');
  });

  it('falls back rather than emitting NaN when digits or period are nonsense', async () => {
    /*
      A NaN here would render as "NaNNaNNaN" on the screen a family is relying
      on. Falling back to the defaults produces a code that is at worst wrong for
      that service, rather than obviously broken for every service.
    */
    const p = parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=abc&period=0');
    expect(p).toMatchObject({ digits: 6, period: 30 });
    const { code } = await generateTotp(p!, 0);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('returns null for things that are not a time-based secret', () => {
    expect(parseOtpauth('')).toBeNull();
    expect(parseOtpauth('not a uri at all!')).toBeNull();
    expect(parseOtpauth('https://example.com?secret=JBSWY3DPEHPK3PXP')).toBeNull();
    // Counter-based HOTP cannot be generated from a clock, so accepting it would
    // produce confidently wrong codes.
    expect(parseOtpauth('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1')).toBeNull();
    expect(parseOtpauth('otpauth://totp/x?issuer=Google')).toBeNull();
    // A URI whose secret is not decodable is worse than no secret at all.
    expect(parseOtpauth('otpauth://totp/x?secret=nope!!!')).toBeNull();
  });
});
