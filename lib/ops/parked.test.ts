/**
 * Relay is PARKED (2026-10-25, Steve's ruling; PROJECT.yaml → parked).
 *
 * The park is one redirect in next.config.mjs, and the ways it can go wrong are
 * all silent: a source pattern that also matches /paused.html loops forever, one
 * that skips /_next/ breaks nothing visible here but blanks the page in a
 * browser, and one that misses the root leaves the old home page serving with
 * its sign-in. So the pattern is matched the way Next matches it — with Next's
 * own compiled path-to-regexp — against the paths that decide it.
 *
 * Unparking removes this file in the same change that flips PARKED.
 *
 * Feature: relay-h0-mvp
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error -- Next ships its compiled path-to-regexp without type declarations.
import { pathToRegexp } from 'next/dist/compiled/path-to-regexp';
import nextConfig from '../../next.config.mjs';

async function parkRule() {
  const redirects = await nextConfig.redirects();
  return redirects[0];
}

function matches(source: string, path: string): boolean {
  return pathToRegexp(source, [], { strict: true, sensitive: false, delimiter: '/' }).test(path);
}

describe('relay is parked', () => {
  it('the first redirect sends the site to the static paused page, temporarily', async () => {
    const rule = await parkRule();
    expect(rule.destination).toBe('/paused.html');
    expect(rule.permanent).toBe(false);
    expect(existsSync(join(process.cwd(), 'public', 'paused.html'))).toBe(true);
  });

  it.each(['/', '/vault', '/api/health/scheduler', '/api/cron/heartbeat', '/auth/signin', '/guide', '/demo'])(
    'redirects %s',
    async (path: string) => {
      expect(matches((await parkRule()).source, path)).toBe(true);
    },
  );

  it.each(['/paused.html', '/_next/static/chunks/app.js', '/icon.svg', '/favicon.ico'])(
    'does NOT redirect %s (the page must be able to render, and must not loop)',
    async (path: string) => {
      expect(matches((await parkRule()).source, path)).toBe(false);
    },
  );
});
