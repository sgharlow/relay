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

  /**
   * REPLACED 2026-08-08, exactly as the old guard instructed.
   *
   * This used to assert that NO scheduled job resolved an elapsed grace window
   * — encoding the limitation that made GRACE_WINDOW_MS unusable above 0. The
   * resolver now exists, so the guard flips: it asserts the resolver is there,
   * and that it stays conservative.
   */
  it('a scheduled resolver exists, so a non-zero grace window no longer strands releases', async () => {
    const heartbeat = await import('./heartbeat');
    expect(Object.keys(heartbeat)).toContain('resolveElapsedGrace');
  });

  it('the resolver releases ONLY rows that already have full quorum', async () => {
    // The danger of adding a resolver is that it becomes a second, weaker path
    // to release. It must never lower a threshold or release early — quorum is
    // a precondition in the query itself, not a check a caller might skip.
    const src = await import('fs').then((fs) =>
      fs.readFileSync(new URL('./heartbeat.ts', import.meta.url), 'utf8'),
    );
    const body = src.slice(src.indexOf('export async function resolveElapsedGrace'));

    expect(body).toContain('received_confirmations >= required_confirmations');
    expect(body).toContain("state = 'grace'");
    expect(body).toContain('grace_ends_at <=');
  });
});
