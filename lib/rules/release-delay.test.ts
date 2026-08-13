/**
 * Tests for the staged half of an access rule.
 *
 * 🔴 THE CONTROL WAS INERT. `release_after_days` was offered on /rules, validated,
 * stored, read back into the form and documented in the user manual as holding a
 * rule back. No code that decided access ever read it, so an owner who staged
 * their most sensitive items behind a week got them opened in the first minute
 * along with everything else — and nothing they could see would have said so.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDelayElapsed, opensAt } from './release-delay';

const RELEASED = '2026-08-01T00:00:00.000Z';
const at = (iso: string) => new Date(iso);

describe('isDelayElapsed', () => {
  it('opens immediately when no delay was asked for', () => {
    for (const none of [null, undefined, 0]) {
      expect(isDelayElapsed(none, RELEASED, at('2026-08-01T00:00:01.000Z'))).toBe(true);
    }
  });

  it('HOLDS a staged item during the window — the whole point', () => {
    expect(isDelayElapsed(7, RELEASED, at('2026-08-01T00:00:01.000Z'))).toBe(false);
    expect(isDelayElapsed(7, RELEASED, at('2026-08-07T23:59:59.000Z'))).toBe(false);
  });

  it('opens exactly on the boundary, not a tick later', () => {
    expect(isDelayElapsed(7, RELEASED, at('2026-08-08T00:00:00.000Z'))).toBe(true);
  });

  it('stays open afterwards', () => {
    expect(isDelayElapsed(7, RELEASED, at('2027-01-01T00:00:00.000Z'))).toBe(true);
  });

  /*
    FAILS CLOSED. The only way to reach "staged rule, no released_at" is a row
    written outside the normal transitions, and guessing "probably fine" about an
    item its owner deliberately asked to hold back is the wrong guess.
  */
  it('holds rather than opens when the release has no timestamp', () => {
    expect(isDelayElapsed(7, null, at('2027-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('holds rather than opens when the timestamp is unparseable', () => {
    expect(isDelayElapsed(7, 'not a date', at('2027-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('an undelayed rule is unaffected by a missing timestamp', () => {
    expect(isDelayElapsed(null, null)).toBe(true);
  });
});

describe('opensAt', () => {
  it('names the moment a staged rule opens', () => {
    expect(opensAt(7, RELEASED)?.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it('is null when there is nothing to wait for', () => {
    expect(opensAt(null, RELEASED)).toBeNull();
    expect(opensAt(7, null)).toBeNull();
  });
});

/*
  BOTH GATES, OR NEITHER. Two independent paths decide whether a recipient sees
  an item — the KMS unwrap gate and the dashboard decrypt path — and the original
  defect was exactly that a rule lived in the schema while every call site forgot
  it. A convention each consumer must remember is one a future consumer will not,
  so this asserts the wiring rather than trusting it.
*/
describe('every access gate consults the delay', () => {
  const GATES = ['lib/kms/unwrap-gate.ts', 'lib/access/dashboard.ts'];

  for (const gate of GATES) {
    it(`${gate} calls isDelayElapsed`, () => {
      expect(readFileSync(gate, 'utf8')).toContain('isDelayElapsed(');
    });
  }

  it('nobody has re-implemented the arithmetic somewhere else', () => {
    for (const gate of GATES) {
      const src = readFileSync(gate, 'utf8');
      expect(src).not.toMatch(/86_?400_?000/);
    }
  });
});
