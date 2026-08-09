/**
 * Renders an enrolment QR entirely in the caller's process.
 *
 * WHY THIS IS NOT A HOSTED QR IMAGE. The payload is an `otpauth://` URL, and
 * that URL contains the TOTP secret in the clear. Handing it to a QR-image
 * service — even one that promises not to log — would mean the single credential
 * protecting every owner's vault takes a trip through a third party on its way
 * to the screen. This encodes locally and emits markup; nothing is fetched, so
 * there is no third party to trust.
 *
 * The alternative that shipped in the meantime was asking a person to
 * transcribe a 32-character base32 key into a phone keypad, at the one step
 * standing between an ad click and a paid account, for an audience of older
 * caregivers. A privacy objection to one implementation was allowed to remove
 * the capability; it should only ever have constrained how it was built.
 *
 * Feature: relay-g1-wtp
 * Requirements: 17.1, J1-R3
 */

import QRCode from 'qrcode';

/**
 * The quiet zone, in modules. The QR spec requires at least four; without it
 * scanners fail to find the symbol against a busy background. Cheap insurance
 * against "it works on my screenshot but not on my mother's kitchen table".
 */
export const QR_MARGIN_MODULES = 4;

/**
 * Medium correction recovers ~15% of a damaged symbol. Enough for a fingerprint
 * on a phone screen or a creased printout, without inflating the symbol so far
 * that it stops being legible at small sizes.
 */
const ERROR_CORRECTION = 'M' as const;

/**
 * Encodes `url` as a self-contained, scalable SVG.
 *
 * Sizing is deliberately relative — the caller constrains the box. A pixel size
 * baked in here either overflows a 320px phone or renders too small to scan on
 * a desktop, and the enrolment screen has to work on both.
 *
 * @throws if `url` is blank — a QR of an empty string is a valid, scannable
 *   symbol that carries nothing, which would look correct and enrol nobody.
 */
export function otpauthQrSvg(url: string): string {
  if (!url.trim()) {
    throw new Error('otpauthQrSvg: refusing to encode an empty payload');
  }

  const { modules } = QRCode.create(url, { errorCorrectionLevel: ERROR_CORRECTION });
  const { size, data } = modules;
  const extent = size + QR_MARGIN_MODULES * 2;

  const rects: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col] !== 1) continue;
      const x = col + QR_MARGIN_MODULES;
      const y = row + QR_MARGIN_MODULES;
      rects.push(`<rect class="m" x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }

  // shape-rendering="crispEdges" stops the browser antialiasing module seams
  // into grey mush at small sizes, which is exactly where scanning fails.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"`,
    ` width="100%" height="100%" shape-rendering="crispEdges" role="img"`,
    ` aria-label="QR code for adding Relay to your authenticator app">`,
    `<rect x="0" y="0" width="${extent}" height="${extent}" fill="#ffffff"/>`,
    `<g fill="#0f172a">${rects.join('')}</g>`,
    `</svg>`,
  ].join('');
}
