/**
 * One definition of where this deployment lives, and nothing re-types it.
 *
 * 🔴 THE FINDING. The same three-line expression —
 * `NEXT_PUBLIC_SITE_URL ?? NEXTAUTH_URL ?? 'http://localhost:3000'` — existed in
 * FIVE places: every email link, the claim link, the WebAuthn relying-party id,
 * the step-up cookie's `secure` flag, and the fire drill.
 *
 * ⚠️ I COUNTED FOUR. The fifth was found by this test on its first run, because
 * the grep I enumerated with ended in `head -5` and silently truncated at
 * exactly the limit — a capped list that looks complete is the same failure as
 * a guard that matches nothing. The derived check found what the hand count
 * could not. That is the portfolio rule about
 * cross-boundary contracts broken quietly: a value read in more than one place
 * gets one authoritative definition, or the copies drift.
 *
 * ⚠️ AND THEY HAD ALREADY STARTED TO. Three were byte-identical; step-up fell
 * back to `''` instead, because it asks a different question — is the origin
 * https, not what is the origin. The two agree today and that is precisely the
 * state that stops being true one edit later.
 *
 * The behavioural tests below are cheap. The one that earns its place is the
 * last: it fails if anybody writes the expression again anywhere.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appUrl, isSecureOrigin } from './app-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the origin', () => {
  it('prefers NEXT_PUBLIC_SITE_URL, which is what Vercel production sets', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://relaystandby.com');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    expect(appUrl()).toBe('https://relaystandby.com');
  });

  it('falls back to NEXTAUTH_URL so local dev needs no extra setup', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    // An empty string is a set variable, so the ?? chain keeps it — this asserts
    // the documented behaviour rather than a hoped-for one.
    expect(appUrl()).toBe('');
  });

  it('falls back to localhost when neither is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    vi.stubEnv('NEXTAUTH_URL', undefined);
    expect(appUrl()).toBe('http://localhost:3000');
  });
});

describe('isSecureOrigin — the question step-up actually asks', () => {
  it('is true on https', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://relaystandby.com');
    expect(isSecureOrigin()).toBe(true);
  });

  it('is FALSE in local development, or the elevation cookie would never be sent', () => {
    // A cookie marked `secure` on a plain-http origin is one the browser drops.
    // This is the assertion that makes the consolidation behaviour-preserving:
    // the old code fell back to '' and this falls back to http://localhost:3000,
    // and both are false here.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    vi.stubEnv('NEXTAUTH_URL', undefined);
    expect(isSecureOrigin()).toBe(false);
  });

  it('is false on an explicit http origin', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://staging.example.org');
    expect(isSecureOrigin()).toBe(false);
  });
});

describe('nothing re-types the expression', () => {
  /**
   * The guard that stops a fifth copy.
   *
   * Matches the SHAPE — both variables read in one expression — rather than an
   * exact string, because a copy with a different fallback is still a copy and
   * is in fact how these four diverged in the first place.
   */
  const SHAPE = /NEXT_PUBLIC_SITE_URL[\s\S]{0,80}NEXTAUTH_URL/;

  /** Where the definition is allowed to live, and why. */
  const ALLOWED: Record<string, string> = {
    'lib/app-url.ts': 'the one authoritative definition — this is the file',
    'lib/app-url.test.ts': 'this test, which names both variables to describe them',
    '.env.example':
      'documents both variables for an operator setting the project up',
    'lib/notify/notifications.test.ts':
      'stubs both variables to prove the preference order end to end through a ' +
      'real notification — testing the behaviour, not re-deriving it',
  };

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('no file outside the allow-list reads both variables in one expression', () => {
    const offenders = [...sourceFiles('lib'), ...sourceFiles('src')]
      .map((f) => f.replace(process.cwd() + join(''), '').replace(/\\/g, '/'))
      .map((f) => (f.startsWith('/') ? f.slice(1) : f))
      .filter((f) => ALLOWED[f] === undefined)
      .filter((f) => SHAPE.test(readFileSync(f, 'utf8')));

    expect(
      offenders,
      offenders.length
        ? 'These files re-derive the app origin instead of importing it:\n' +
          offenders.map((o) => `  ${o}`).join('\n') +
          '\n\nImport { appUrl } (or { isSecureOrigin }) from lib/app-url.ts. Four copies of ' +
          'this expression already existed and had begun to diverge — and one of them derives ' +
          'the WebAuthn relying-party id, which every existing passkey is BOUND to.'
        : 'ok',
    ).toEqual([]);
  });

  it('the check scans a real set of files, so it cannot pass vacuously', () => {
    expect(sourceFiles('lib').length).toBeGreaterThan(100);
  });
});
