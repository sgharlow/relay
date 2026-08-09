/**
 * Tests for the enrolment QR renderer.
 *
 * A QR was deliberately left out of signup because the obvious implementation —
 * a hosted QR image service — would have sent the `otpauth://` URL, and with it
 * the TOTP secret, to a third party. That objection was right about the
 * implementation and wrong about the capability: the alternative shipped for
 * months was a human transcribing a 32-character base32 key into a phone, at
 * the one step between an ad click and a paid account.
 *
 * So the constraint under test is not "a QR exists" but "a QR exists AND
 * nothing leaves the browser to produce it".
 *
 * Feature: relay-g1-wtp
 * Requirements: 17.1, J1-R3
 */

import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';

import { otpauthQrSvg, QR_MARGIN_MODULES } from './totp-qr';

const SECRET = 'YXU4GM3OE6I2C5RRXNPKVRO6JOKIWQPJ';
const URL = `otpauth://totp/Relay:owner%40example.com?secret=${SECRET}&issuer=Relay&algorithm=SHA1&digits=6&period=30`;

/**
 * Counts the drawn modules, which is a fingerprint of the encoded payload.
 * Keyed on the module class rather than on `<rect`, so the light background —
 * which a scanner needs, and which printing needs more — is not miscounted as
 * data.
 */
function darkModuleCount(svg: string): number {
  return (svg.match(/class="m"/g) ?? []).length;
}

function darkModulesFor(payload: string): number {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  return [...modules.data].filter((bit) => bit === 1).length;
}

describe('otpauthQrSvg', () => {
  it('encodes the otpauth URL, not the bare secret', () => {
    const svg = otpauthQrSvg(URL);

    // The failure this catches is passing `secret` where `otpauthUrl` belongs.
    // It renders a perfectly valid QR that no authenticator app can use, and it
    // looks correct in a screenshot — so only the payload distinguishes them.
    expect(darkModuleCount(svg)).toBe(darkModulesFor(URL));
    expect(darkModuleCount(svg)).not.toBe(darkModulesFor(SECRET));
  });

  it('fetches nothing — no third party ever sees the secret', () => {
    const svg = otpauthQrSvg(URL);

    // Constructs that retrieve. The SVG namespace is a URI too, but it is an
    // identifier that is never dereferenced, so banning the substring "http"
    // outright would fail an implementation that is in fact self-contained.
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('href');
    expect(svg).not.toMatch(/url\(/);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('@import');

    // Every URL in the markup must be the namespace and nothing else.
    const urls = svg.match(/https?:\/\/[^"'\s)]+/g) ?? [];
    expect(urls).toEqual(['http://www.w3.org/2000/svg']);

    // And the payload must never appear as readable text in the markup.
    expect(svg).not.toContain(SECRET);
  });

  it('is a square with a quiet zone, or scanners will not see it', () => {
    const svg = otpauthQrSvg(URL);
    const size = QRCode.create(URL, { errorCorrectionLevel: 'M' }).modules.size;
    const expected = size + QR_MARGIN_MODULES * 2;

    expect(svg).toContain(`viewBox="0 0 ${expected} ${expected}"`);
    expect(QR_MARGIN_MODULES).toBeGreaterThanOrEqual(4); // the spec's minimum
  });

  it('scales to fill its container rather than assuming a pixel size', () => {
    // The enrolment screen is used on phones. A fixed-pixel QR either overflows
    // a 320px viewport or renders too small to scan on a large one.
    const svg = otpauthQrSvg(URL);
    expect(svg).toMatch(/width="100%"/);
  });

  it('refuses an empty payload instead of drawing a scannable picture of nothing', () => {
    expect(() => otpauthQrSvg('')).toThrow();
    expect(() => otpauthQrSvg('   ')).toThrow();
  });

  it('handles a long account name without throwing', () => {
    const long = `otpauth://totp/Relay:${encodeURIComponent(
      'a-rather-long-address-someone-might-really-use@a-long-domain-name.example.com',
    )}?secret=${SECRET}&issuer=Relay&algorithm=SHA1&digits=6&period=30`;

    expect(() => otpauthQrSvg(long)).not.toThrow();
  });
});
