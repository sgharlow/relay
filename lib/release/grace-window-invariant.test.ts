/**
 * Guard test: the grace window is a RULING, not a config knob.
 *
 * ⚖️ RULED 2026-08-12. It used to be one constant pinned at 0, and this file
 * explained at length why raising it would strand releases — true until
 * 2026-08-08, when `resolveElapsedGrace` shipped and removed that limitation.
 * The constant was then never revisited, so the product kept a value whose only
 * remaining justification was a comment describing a problem that had been
 * fixed four days earlier.
 *
 * The ruling is that ONE number was the mistake. Reversible and irreversible
 * releases have opposite requirements:
 *
 *   REVERSIBLE → 0. `processCheckin` reverses PENDING, GRACE and RELEASED, so
 *   the owner can already close access that has opened. A delay adds nothing
 *   and costs a family waiting on a hospital's insurance portal.
 *
 *   ESTATE → 72h. `processCheckin` puts estate in `blocked` — permanent once
 *   released — so this window is the ONLY moment anyone can intervene. Not an
 *   artificial delay; the entire protection.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.5, 6.5, 6.6
 */

import { describe, it, expect } from 'vitest';
import { graceWindowMs } from './triggers';
import { canRelease, isReversibleTrigger } from './state-machine';
import { VALID_TRIGGER_TYPES } from '../rules/access-rules';
import { CHALLENGE_WINDOW_SECONDS } from './access-request';

describe('the ruling', () => {
  it('is ZERO for every reversible trigger', () => {
    for (const t of VALID_TRIGGER_TYPES.filter(isReversibleTrigger)) {
      expect(graceWindowMs(t)).toBe(0);
    }
  });

  it('is THREE DAYS for estate, the one that cannot be undone', () => {
    expect(isReversibleTrigger('estate')).toBe(false);
    expect(graceWindowMs('estate')).toBe(72 * 60 * 60 * 1000);
  });

  it('agrees with the estate challenge window, because they answer one question', () => {
    // How long before something permanent happens to this person's estate. Two
    // numbers answering it is how they drift apart.
    expect(graceWindowMs('estate')).toBe(CHALLENGE_WINDOW_SECONDS.estate * 1000);
  });

  it('NEVER returns zero for an irreversible trigger, whatever is added later', () => {
    // The load-bearing property. A future trigger type that cannot be reversed
    // must not inherit the reversible answer by default.
    for (const t of VALID_TRIGGER_TYPES) {
      if (!isReversibleTrigger(t)) expect(graceWindowMs(t)).toBeGreaterThan(0);
    }
  });
});

describe('what the window does to release', () => {
  it('with a zero window, a met quorum releases immediately', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const graceEndsAt = new Date(now.getTime() + graceWindowMs('emergency')).toISOString();
    expect(canRelease(2, 2, graceEndsAt, now)).toBe(true);
  });

  it('with the estate window, a met quorum waits', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const graceEndsAt = new Date(now.getTime() + graceWindowMs('estate')).toISOString();

    // Quorum satisfied and still not releasable — which is the point.
    expect(canRelease(2, 2, graceEndsAt, now)).toBe(false);

    // ...and it releases once the window has passed.
    const later = new Date(now.getTime() + 73 * 60 * 60 * 1000);
    expect(canRelease(2, 2, graceEndsAt, later)).toBe(true);
  });
});

describe('the resolver a non-zero window depends on', () => {
  /**
   * ⚠️ WITHOUT THIS, A NON-ZERO WINDOW STRANDS RATHER THAN DELAYS.
   * `submitConfirmation` evaluates `canRelease` once, at confirmation time; if
   * the window has not elapsed it returns `pending_grace` and nothing re-drives
   * the row. The estate ruling above is only safe because a scheduled resolver
   * picks those rows up.
   */
  it('exists and is wired into the cron, not merely defined', async () => {
    const heartbeat = await import('./heartbeat');
    expect(Object.keys(heartbeat)).toContain('resolveElapsedGrace');

    const fs = await import('fs');
    const route = fs.readFileSync(
      new URL('../../src/app/api/cron/heartbeat/route.ts', import.meta.url),
      'utf8',
    );
    expect(route).toContain('resolveElapsedGrace(');
  });

  it('releases ONLY rows that already have full quorum', async () => {
    // The danger of a resolver is that it becomes a second, weaker path to
    // release. Quorum is a precondition in the query itself, not a check a
    // caller might skip.
    const src = await import('fs').then((fs) =>
      fs.readFileSync(new URL('./heartbeat.ts', import.meta.url), 'utf8'),
    );
    const body = src.slice(src.indexOf('export async function resolveElapsedGrace'));

    expect(body).toContain('received_confirmations >= required_confirmations');
    expect(body).toContain("state = 'grace'");
    expect(body).toContain('grace_ends_at <=');
  });
});
