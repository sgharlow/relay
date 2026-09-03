/**
 * The operator alert has to appear in the same ledger as everything else Relay sends.
 *
 * 🔴 THE SWITCH THIS DISARMED. `webhook-health.ts` decides the recorder has
 * stopped writing by looking for delivery events with no matching row in
 * `email_send_attempts` — and that rests on one invariant: every event we store
 * is about a message we recorded sending. `attributableToRelay` keeps other
 * products' mail out, correctly and on DOMAIN (a future `alerts@` is still
 * Relay), so an operator alert sent from `hello@relaystandby.com` IS stored.
 *
 * The B12.i heartbeat sends by POSTing `api.resend.com` directly — deliberately,
 * so it still works when the app is down — which skipped `recordSendAttempt`.
 * Measured on production 2026-09-03: `orphanEvents: 2`, exactly the two
 * heartbeat alerts (09-02 04:55Z, 09-03 02:21Z), against `ripeSends: 5` /
 * `ripeSendsHeard: 5` and `refusedSends: 0` — every tracked message delivered
 * and heard back. The mail was fine; the switch was stuck.
 *
 * And stuck PERMANENTLY: the orphan query has no upper time bound, so those
 * rows never age out. The heartbeat fires whenever B11 drops the scheduled
 * canaries, so the count only grows. `webhook-health.ts` says in its own
 * comments that a monitor which fires constantly gets muted, "which is how
 * monitors die".
 *
 * The fix restores the invariant rather than adding a second exception to it:
 * the alert path records what it sent, like every other sender.
 *
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';

import { sendOperatorAlert } from './operator-alert';

const MSG = {
  apiKey: 'test-key',
  from: 'hello@relaystandby.com',
  to: 'ops@example.com',
  subject: '[relay] heartbeat: production FAILING',
  text: 'a finding',
};

const accepted = (id: string) => async () =>
  new Response(JSON.stringify({ id }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('sendOperatorAlert', () => {
  it('records a send attempt for the id the provider returned', async () => {
    const recorded: string[] = [];

    const sent = await sendOperatorAlert(MSG, {
      fetchImpl: accepted('resend-abc') as unknown as typeof fetch,
      recordAttempt: async (id) => void recorded.push(id),
    });

    expect(sent).toBe(true);
    expect(recorded).toEqual(['resend-abc']);
  });

  /*
    The ledger is telemetry and the alert is the emergency. A watchdog that
    could not alert because the database was unreachable would fail in exactly
    the conditions it exists for — and an unreachable database is one of them.
  */
  it('still reports the alert as sent when the ledger write throws', async () => {
    const sent = await sendOperatorAlert(MSG, {
      fetchImpl: accepted('resend-xyz') as unknown as typeof fetch,
      recordAttempt: async () => {
        throw new Error('DSQL unavailable');
      },
    });

    expect(sent).toBe(true);
  });

  /*
    A refused send has no provider id, so there is nothing to record and nothing
    for the webhook to deliver an event about. Recording here would invent a
    send that never happened.
  */
  it('records nothing when the provider refuses the alert', async () => {
    const recorded: string[] = [];

    const sent = await sendOperatorAlert(MSG, {
      fetchImpl: (async () => new Response('rejected', { status: 422 })) as unknown as typeof fetch,
      recordAttempt: async (id) => void recorded.push(id),
    });

    expect(sent).toBe(false);
    expect(recorded).toEqual([]);
  });
});
