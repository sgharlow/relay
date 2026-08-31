/**
 * A correctly-refused third party must not read as a broken page.
 *
 * See `lib/ops/csp-violations.ts`. Measured 2026-08-31: all six enforced
 * violations were the Vercel toolbar, reported under "A real person met a broken
 * page". True of the mechanism, wrong about the meaning — and the cost of being
 * wrong that way is that the enforced section stops being read.
 *
 * Feature: relay-h0-mvp
 * Requirements: B21.2, B21.3, B21.4
 */

import { describe, it, expect } from 'vitest';
import {
  splitEnforced,
  nextRungVerdict,
  NOT_PRODUCT_CODE,
  type ViolationRow,
} from './csp-violations';

const row = (blocked: string | null, document = 'https://relaystandby.com/'): ViolationRow => ({
  blocked,
  directive: 'script-src-elem',
  document,
  n: '1',
});

/** The six rows measured live on 2026-08-31. */
const LIVE_ENFORCED: ViolationRow[] = [
  row('https://vercel.live/_next-live/feedback/feedback.js', 'https://relaystandby.com/auth/signin'),
  row('https://vercel.live/_next-live/feedback/feedback.js', 'https://relaystandby.com/demo'),
  row('https://vercel.live/_next-live/feedback/feedback.js'),
  row('https://vercel.live/_next-live/feedback/feedback.js', 'https://relaystandby.com/auth/'),
  row('https://vercel.live/_next-live/feedback/feedback.js', 'https://relaystandby.com/caregivers'),
  row('https://vercel.live/_next-live/feedback/feedback.js', 'https://relaystandby.com/terms'),
];

describe('splitting the enforced half', () => {
  it('reports the live 2026-08-31 set as refused third party, not as product defects', () => {
    const s = splitEnforced(LIVE_ENFORCED);
    expect(s.productDefects).toEqual([]);
    expect(s.refusedThirdParty).toHaveLength(6);
    expect(s.refusedThirdParty[0].reason).toMatch(/never served to a customer/);
  });

  it('🔴 still calls a blocked SELF-served script a defect', () => {
    /*
      The assertion the whole module has to get right. Softening the enforced
      half is only safe if the thing it exists to catch still comes through.
    */
    const s = splitEnforced([row('https://relaystandby.com/_next/static/chunks/main.js')]);
    expect(s.productDefects).toHaveLength(1);
    expect(s.refusedThirdParty).toEqual([]);
  });

  it('does not let a known third party hide a real one in the same batch', () => {
    const s = splitEnforced([...LIVE_ENFORCED, row('https://evil.example/x.js')]);
    expect(s.productDefects.map((r) => r.blocked)).toEqual(['https://evil.example/x.js']);
    expect(s.refusedThirdParty).toHaveLength(6);
  });

  it('treats an inline block as product code, because it is', () => {
    const s = splitEnforced([row('inline')]);
    expect(s.productDefects).toHaveLength(1);
  });

  it('matches on a prefix, so a lookalike host is not swept in', () => {
    // `vercel.live.evil.example` must not inherit vercel.live's exemption.
    const s = splitEnforced([row('https://vercel.live.evil.example/x.js')]);
    expect(s.productDefects).toHaveLength(1);
    expect(s.refusedThirdParty).toEqual([]);
  });

  it('every exemption argues for itself', () => {
    for (const [origin, reason] of Object.entries(NOT_PRODUCT_CODE)) {
      expect(reason.length, `${origin}: too short to be a reason`).toBeGreaterThan(40);
      expect(origin).toMatch(/^https:\/\//);
      // A trailing slash, so `https://vercel.liveX` cannot prefix-match.
      expect(origin.endsWith('/'), `${origin}: must end in / or it prefix-matches a lookalike`).toBe(true);
    }
  });
});

describe('the next-rung verdict', () => {
  it('refuses the rung on inline violations and names the work', () => {
    const v = nextRungVerdict([row('inline'), row('inline', 'https://relaystandby.com/demo')]);
    expect(v.takeable).toBe(false);
    expect(v.because).toMatch(/nonces or hashes FIRST/);
    expect(v.because).toMatch(/not a header flip/);
  });

  it('refuses on non-inline violations too, with a different reason', () => {
    const v = nextRungVerdict([row('https://cdn.example/a.js')]);
    expect(v.takeable).toBe(false);
    expect(v.because).toMatch(/origin added to the policy/);
  });

  it('allows the rung on an empty set — while naming the other meaning of zero', () => {
    /*
      ⚠️ An empty table means EITHER "nothing violates the stricter policy" OR
      "reports are not reaching the endpoint". Collapsing those is how a monitor
      lies, so the verdict carries the caveat rather than a bare yes.
    */
    const v = nextRungVerdict([]);
    expect(v.takeable).toBe(true);
    expect(v.because).toMatch(/provided reports are actually arriving/);
  });
});
