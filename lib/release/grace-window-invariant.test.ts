/**
 * Guard test: GRACE_WINDOW_MS = 0 is LOAD-BEARING, not a config knob.
 *
 * `submitConfirmation` is the only driver of GRACE -> RELEASED, and it evaluates
 * `canRelease` exactly once, at confirmation time. If the grace window has not
 * elapsed it returns `pending_grace` and returns — and nothing re-drives it.
 * No cron sweeps GRACE rows whose window has since passed
 * (`runHeartbeatSweep` only selects `state = 'armed'`).
 *
 * So raising GRACE_WINDOW_MS above 0 does NOT add an owner-cancel window. It
 * strands the release permanently: quorum met, owner notified "pending grace",
 * release never completes.
 *
 * This test exists so that anyone who flips that constant fails here with an
 * explanation, instead of silently breaking every release in production.
 *
 * To make the window genuinely configurable, first add a cron that resolves
 * GRACE rows where `grace_ends_at <= now()` and `received >= required`.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.5, 6.5, 6.6
 */

import { describe, it, expect } from 'vitest';
import { GRACE_WINDOW_MS } from './triggers';
import { canRelease } from './state-machine';

describe('GRACE_WINDOW_MS invariant', () => {
  it('is 0 — raising it strands releases until a grace-elapsed sweep exists', () => {
    expect(GRACE_WINDOW_MS).toBe(0);
  });

  it('with the window at 0, a met quorum can release immediately', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const graceEndsAt = new Date(now.getTime() + GRACE_WINDOW_MS).toISOString();

    expect(canRelease(2, 2, graceEndsAt, now)).toBe(true);
  });

  it('demonstrates the strand: a future grace window blocks release even at full quorum', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Quorum is satisfied, yet canRelease is false purely because of the window.
    expect(canRelease(2, 2, future, now)).toBe(false);

    // submitConfirmation returns 'pending_grace' here and no other code path
    // re-evaluates the row later, so the release would never complete.
  });

  it('confirms no scheduled job resolves an elapsed grace window', async () => {
    // If a grace-elapsed sweep is ever added, export it and assert it here
    // instead of this guard, then this test should be replaced.
    const heartbeat = await import('./heartbeat');

    expect(Object.keys(heartbeat)).not.toContain('runGraceSweep');
    expect(Object.keys(heartbeat)).not.toContain('resolveElapsedGrace');
  });
});
