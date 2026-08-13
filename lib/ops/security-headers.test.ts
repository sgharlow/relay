/**
 * The response headers the product sends, and the ones it deliberately does not.
 *
 * 🔴 THERE WERE NONE until 2026-08-13. The pre-release audit grepped the whole
 * repo for Content-Security-Policy, Strict-Transport-Security, X-Frame-Options,
 * Referrer-Policy and an `async headers(` and got no matches, in a product that
 * decrypts vault plaintext in the browser.
 *
 * WHY A TEST AND NOT JUST CONFIG. A header block is invisible. Nothing renders
 * differently when one goes missing, no test fails, and a page keeps working
 * perfectly while its protection is gone — so the only way a deletion or a typo
 * gets noticed is if something asserts the values. This is that.
 *
 * It reads next.config.mjs through its real export rather than re-stating the
 * strings, so the file under test and the file that ships are the same file.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import nextConfig from '../../next.config.mjs';

async function headerMap(): Promise<Record<string, string>> {
  const rules = await nextConfig.headers();
  const catchAll = rules.find((r) => r.source === '/:path*');
  expect(catchAll, 'headers() must cover every route, not a subset').toBeDefined();
  return Object.fromEntries(catchAll.headers.map((h) => [h.key, h.value]));
}

describe('security headers', () => {
  it('applies to every route', async () => {
    const rules = await nextConfig.headers();
    expect(rules.map((r) => r.source)).toContain('/:path*');
  });

  it('sends HSTS for at least a year', async () => {
    const v = (await headerMap())['Strict-Transport-Security'];
    expect(v).toBeDefined();
    const maxAge = Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    expect(v).toContain('includeSubDomains');
  });

  /*
    NOT preloaded, and that is a decision rather than an omission. Preload is
    effectively irreversible — a browser that has seen it keeps refusing plain
    HTTP for this domain and every subdomain for the life of the max-age,
    whatever the site later does. Reversibility is the thing this product sells;
    it should hold itself to it too.
  */
  it('does not claim preload', async () => {
    expect((await headerMap())['Strict-Transport-Security']).not.toContain('preload');
  });

  it('refuses to be framed', async () => {
    expect((await headerMap())['X-Frame-Options']).toBe('DENY');
  });

  it('stops content-type sniffing', async () => {
    expect((await headerMap())['X-Content-Type-Options']).toBe('nosniff');
  });

  /*
    The unclaimed-contact fallback still carries ?token= in a URL. Under the
    default policy, a recipient following any off-site link from an access
    screen would hand that entire URL to the destination.
  */
  it('does not leak a full URL cross-origin', async () => {
    const v = (await headerMap())['Referrer-Policy'];
    expect(['strict-origin-when-cross-origin', 'no-referrer', 'same-origin']).toContain(v);
  });

  /*
    🔴 THE HEADER MOST LIKELY TO BREAK SOMETHING QUIETLY. Passkeys are gated by
    publickey-credentials-get / publickey-credentials-create, whose default
    allowlist is already 'self'. Naming them in a restrictive Permissions-Policy
    is how sign-in stops working for a reason nobody looks for — the failure
    appears in WebAuthn, not in a header. So they must stay unmentioned.
  */
  it('never names the WebAuthn permissions, which passkeys depend on', async () => {
    const v = (await headerMap())['Permissions-Policy'] ?? '';
    expect(v).not.toContain('publickey-credentials');
    expect(readFileSync('next.config.mjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain(
      'publickey-credentials',
    );
  });

  it('still disables the capabilities this product genuinely never uses', async () => {
    const v = (await headerMap())['Permissions-Policy'] ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(v).toContain(`${feature}=()`);
    }
  });

  /*
    The redirects that were already here are load-bearing security: the legacy
    vercel.app host accepted real sign-ins, and Relay's own emails were once
    found pointing at it. Adding headers() must not have disturbed them.
  */
  it('leaves the legacy-host redirect intact', async () => {
    const redirects = await nextConfig.redirects();
    const legacy = redirects.find((r) =>
      r.has?.some((h) => h.type === 'host' && h.value === 'relay-three-henna.vercel.app'),
    );
    expect(legacy, 'the legacy vercel.app host must still redirect').toBeDefined();
    expect(legacy.permanent).toBe(true);
  });

  it('leaves the /guide rewrite intact', async () => {
    const rewrites = await nextConfig.rewrites();
    expect(rewrites).toContainEqual({ source: '/guide', destination: '/guide/index.html' });
  });
});
