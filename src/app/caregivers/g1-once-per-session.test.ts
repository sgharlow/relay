/**
 * The G1 ratio counts VISITORS, not page views.
 *
 * 🔴 THE MISMATCH. `PROJECT.yaml` specifies the gate as "N >= 100 qualified
 * visitors" and docs/g1-wtp-test-design.md as "≥ 2% click-to-intent … N ≥ 100
 * qualified visitors". Both trackers fired on every MOUNT, so one person
 * reloading a page, pressing back, or reopening a tab counted again.
 *
 * The two sides inflate on different actions, so it is not a wash: reloading
 * /caregivers inflates the DENOMINATOR (toward a false kill) and reloading
 * /caregivers/interest inflates the NUMERATOR (toward a false SHIP). The
 * conversion page is the one a visitor is likelier to return to, and a false
 * ship is the error that spends money.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { firstTimeThisSession, QUALIFIED_ONCE_KEY, INTENT_ONCE_KEY } from './analytics';

function withStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const base: Partial<Storage> = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  (globalThis as { window?: unknown }).window = { sessionStorage: { ...base, ...impl } };
}

beforeEach(() => withStorage());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('firstTimeThisSession', () => {
  it('is true once and false thereafter — one visitor, one event', () => {
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(true);
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(false);
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(false);
  });

  /*
    The two sides of the ratio must be independent. A shared key would let a
    visit to the landing page suppress the conversion event on the next page —
    silently zeroing the numerator while the denominator kept counting, which is
    the false-kill direction and the worst possible failure of this fix.
  */
  it('keeps the numerator and denominator independent', () => {
    expect(firstTimeThisSession(QUALIFIED_ONCE_KEY)).toBe(true);
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(true);
    expect(firstTimeThisSession(QUALIFIED_ONCE_KEY)).toBe(false);
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(false);
  });

  it('a genuinely new session counts again', () => {
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(true);
    withStorage(); // a fresh session: new storage, nothing remembered
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(true);
  });

  /*
    ⚠️ FAILS OPEN, and the direction is the point. Private mode and blocked
    storage throw here. The choice is between possibly counting a visitor twice
    and certainly not counting them at all — and silently dropping conversions
    biases toward a false kill while being completely invisible. recallChannel
    beside it makes the same trade.
  */
  it('still counts when storage cannot be read', () => {
    withStorage({ getItem: () => { throw new Error('blocked'); } });
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(true);
  });

  it('still counts when storage cannot be written', () => {
    withStorage({ setItem: () => { throw new Error('quota'); } });
    expect(firstTimeThisSession(INTENT_ONCE_KEY)).toBe(true);
  });

  it('the two keys are distinct strings, not one constant reused', () => {
    expect(QUALIFIED_ONCE_KEY).not.toBe(INTENT_ONCE_KEY);
  });
});

/**
 * 🔴 THE WIRING, WHICH IS THE HALF THAT ACTUALLY SHIPS THE BUG.
 *
 * A guard that is correct and never called is a guard that always says yes.
 * Both trackers are `useEffect`-only components that return null, so
 * `renderToStaticMarkup` cannot exercise them — effects do not run under it.
 * Reading the source is the honest remaining option, and it is the same trade
 * the checks in lib/ops make for the same reason.
 */
describe('both trackers actually consult the guard', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src', 'app', 'caregivers', p), 'utf8');

  const cases = [
    { file: 'QualifiedTracker.tsx', key: 'QUALIFIED_ONCE_KEY', event: 'CAREGIVER_QUALIFIED' },
    { file: 'interest/IntentTracker.tsx', key: 'INTENT_ONCE_KEY', event: 'CAREGIVER_INTENT' },
  ];

  for (const c of cases) {
    it(`${c.file} guards before emitting ${c.event}`, () => {
      const src = read(c.file);
      expect(src).toContain('firstTimeThisSession');
      expect(src).toContain(c.key);

      // ORDER IS THE PROPERTY. A guard placed after the emit would satisfy a
      // bare "contains" assertion while changing nothing at all.
      const guardAt = src.indexOf('firstTimeThisSession(');
      const emitAt = src.indexOf(`trackG1(${c.event}`);
      expect(guardAt).toBeGreaterThan(-1);
      expect(emitAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(emitAt);
    });
  }

  /*
    The denominator's side effects must NOT be behind the guard. `qualifiedProps`
    parks the inbound channel and `rememberClickId` parks the click ID; both feed
    the NEXT page's attribution. Skipping them on a return visit would break the
    attribution of the session this fix exists to count properly.
  */
  it('QualifiedTracker still parks channel and click ID on every mount', () => {
    const src = read('QualifiedTracker.tsx');
    const parkAt = src.indexOf('qualifiedProps(');
    const clickAt = src.indexOf('rememberClickId(');
    const guardAt = src.indexOf('firstTimeThisSession(');
    expect(parkAt).toBeLessThan(guardAt);
    expect(clickAt).toBeLessThan(guardAt);
  });
});
