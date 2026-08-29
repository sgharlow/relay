/**
 * scripts/e2e-sweep.ts — watch the dead-man's switch actually fire.
 *
 * 🔴 THE TRANSITION NOBODY HAS WATCHED. `deferred.shipped-but-unproven-release-
 * guards` (B15) puts it plainly: "The sweep's ARMED → PENDING transition has
 * never been OBSERVED for a real owner, disposable or otherwise. Proving it
 * needs a disposable short-interval owner and the patience to let the interval
 * actually elapse across hourly ticks — not a unit test that calls the
 * function."
 *
 * This is that walk. Relay's entire premise is a release state machine that
 * advances when an owner goes silent; `runHeartbeatSweep` is the only thing that
 * makes it advance unattended, and until now it had been exercised by unit tests
 * calling it directly and by nothing else. Its failure mode is the silent one
 * this repo keeps finding elsewhere: a 200 from the cron route, a healthy
 * `scheduler_runs` ledger, and no transition.
 *
 * WHAT MAKES THIS A REAL PROOF RATHER THAN A LOUD UNIT TEST:
 *   - the owner is a real row created through the ordinary signup API;
 *   - the trigger is a real `release_state` row in ARMED;
 *   - NOTHING IN THIS SCRIPT CALLS THE SWEEP. It backdates the owner and then
 *     waits for the PRODUCTION Vercel cron to find them on its own hourly tick.
 *     The sweep runs on Vercel with `CRON_SECRET`, which is deliberately not in
 *     any local env file, so there is no way to shortcut it from here — which is
 *     exactly why the observation is worth something.
 *
 * ⚠️ IT WRITES DISPOSABLE PRODUCTION ROWS, like every other walk here: `.env.local`
 * points at the production cluster because Relay has no dev database. The owner
 * is created on a reserved domain and closed by `deleteAccount()` at the end.
 * Run `npm run verify:orphans` after.
 *
 * ⚠️ AND IT MUTATES ONE COLUMN DIRECTLY. `last_active_at` and
 * `checkin_interval_days` are backdated with an UPDATE, because the alternative
 * is waiting a real day. That is the one thing here that is not the product's
 * own path, and it is confined to the disposable owner by id. Everything after
 * the backdate — the query that finds them, the transition, the OCC version
 * bump, the audit entry — is the real thing.
 *
 * 🔴 SAFETY: THE SWEEP IS NOT SCOPED TO THIS OWNER. `runHeartbeatSweep` reads
 * every active non-demo owner. This script therefore REFUSES TO RUN if any other
 * owner is already overdue, because in that case the tick it is waiting for
 * would also transition somebody real — and a walk that fires a live customer's
 * release is not a walk. Checked before anything is created.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/e2e-sweep.ts
 *   npx tsx --env-file=.env.local scripts/e2e-sweep.ts --wait 90   (minutes)
 *
 * Feature: relay-h0-mvp
 * Requirements: B15.1; docs/user-journeys.md J5
 */

import { query, closeAllPools } from '../lib/db/connection';
import { Actor, Results, signUp, signIn, claim, closeAll, undeliverable, BASE } from './walk-harness';

const R = new Results();

const WAIT_MINUTES = (() => {
  const i = process.argv.indexOf('--wait');
  const n = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : 75;
})();

interface ReleaseRow {
  id: string;
  trigger_type: string;
  state: string;
  version: string | number;
}

async function rowsFor(email: string): Promise<ReleaseRow[]> {
  const r = await query<ReleaseRow>(
    `SELECT rs.id, rs.trigger_type, rs.state, rs.version
       FROM release_state rs JOIN users u ON u.id = rs.owner_id
      WHERE u.email = $1 ORDER BY rs.trigger_type`,
    [email],
  );
  return r.rows;
}

/** Everyone the sweep would act on RIGHT NOW, excluding one email. */
async function othersOverdue(exceptEmail: string): Promise<string[]> {
  const r = await query<{ email: string }>(
    `SELECT email FROM users
      WHERE status = 'active' AND is_demo_account = false
        AND email <> $1
        AND now() - last_active_at > (checkin_interval_days * INTERVAL '1 day')`,
    [exceptEmail],
  );
  return r.rows.map((x) => x.email);
}

async function lastSchedulerRun(): Promise<string | null> {
  const r = await query<{ ran_at: string }>(
    `SELECT ran_at::text FROM scheduler_runs ORDER BY ran_at DESC LIMIT 1`,
  );
  return r.rows[0]?.ran_at ?? null;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const owner = new Actor('Sweep Owner', undeliverable(`relay-sweep-owner-${stamp}@relay.test`));
  const verifier = new Actor('Sweep Verifier', undeliverable(`relay-sweep-v-${stamp}@relay.test`));

  console.log(`base=${BASE}\n  owner=${owner.email}\n  waiting up to ${WAIT_MINUTES} min for a real cron tick\n`);

  /*
    THE REFUSAL COMES FIRST, before a single row is written. If somebody real is
    already overdue, the tick this walk waits for would transition them too, and
    that is not a cost this script is allowed to impose to prove a point.
  */
  const blockers = await othersOverdue(owner.email);
  R.check(
    'no OTHER owner is already overdue — the tick will not touch anybody real',
    blockers.length === 0,
    blockers.length ? `REFUSING: ${blockers.join(', ')} would also transition` : 'nobody else is due',
  );
  if (blockers.length) {
    console.log('\n🔴 Refused. Someone real is overdue; a sweep tick would fire their release.\n');
    process.exitCode = 1;
    return;
  }

  try {
    await signUp(owner);
    await signIn(owner);

    /*
      A trigger of a user-selectable type, in ARMED — what the sweep looks for.

      ⚠️ The config route refuses a quorum nobody can satisfy, so a verifier has
      to exist first. The first attempt at this walk skipped that and got a
      correct 400: `required_confirmations: 1` against an empty circle is an
      unsatisfiable quorum, and the route is right to refuse it. The verifier is
      left UNCLAIMED on purpose — `countEligibleVerifiers` still counts those
      today (the staging note in lib/release/quorum.ts), and claiming one would
      add a signup this walk does not need against a 10-per-hour limiter.
    */
    const ver = await owner.post('/api/verifiers', {
      name: 'Sweep Verifier',
      email: verifier.email,
      phone: null,
      relationship: 'physician',
    });
    const verifierId = String((ver.body as { id?: string }).id ?? '');
    R.check('a verifier row exists', Boolean(verifierId), `HTTP ${ver.status}`);

    /*
      Claim, then confirm. Both are required and neither is ceremony:
      `isEligibleVerifier` counts only `standby_state === 'confirmed'`
      (requirements section 4.3 — an invited or claimed verifier may still ANSWER,
      but their answer does not advance a threshold that exists to represent
      VERIFIED attestation), and `confirmPerson` refuses anything not already
      `claimed`. The second attempt at this walk created an unclaimed verifier and
      the config route correctly answered "needs 1 people to confirm, but only 0
      could answer".
    */
    const vinv = await owner.post('/api/invitations', { personId: verifierId, personType: 'verifier' });
    await claim(verifier, String((vinv.body as { claimCode?: string }).claimCode));
    const conf = await owner.post(`/api/people/${verifierId}/confirm`, { personType: 'verifier' });
    R.check('the verifier is CONFIRMED, so a quorum of 1 is satisfiable', conf.status === 200, `HTTP ${conf.status}`);

    const cfg = await owner.put('/api/triggers/emergency/config', { required_confirmations: 1 });
    R.check('a trigger is configured', cfg.status === 200, `HTTP ${cfg.status} ${JSON.stringify(cfg.body)}`);

    const before = await rowsFor(owner.email);
    const armed = before.filter((r) => r.state === 'armed');
    R.check(
      'the owner holds at least one ARMED release_state',
      armed.length > 0,
      armed.map((a) => `${a.trigger_type}=${a.state} v${a.version}`).join(' ') || 'none',
    );
    if (!armed.length) throw new Error('nothing armed to sweep');

    const target = armed[0];

    /*
      Backdate. `checkin_interval_days` is the smallest unit the schema offers, so
      going overdue without waiting a real day means moving `last_active_at`
      backwards rather than shortening the interval below its floor.
    */
    await query(
      `UPDATE users
          SET checkin_interval_days = 1,
              last_active_at = now() - INTERVAL '3 days'
        WHERE email = $1`,
      [owner.email],
    );
    const chk = await query<{ overdue: boolean }>(
      `SELECT (now() - last_active_at > (checkin_interval_days * INTERVAL '1 day')) AS overdue
         FROM users WHERE email = $1`,
      [owner.email],
    );
    R.check(
      'the owner is now overdue by the sweep\'s own predicate',
      chk.rows[0]?.overdue === true,
      'interval 1d, last active 3d ago',
    );

    const tickBefore = await lastSchedulerRun();
    console.log(`\n  last scheduler run before waiting: ${tickBefore ?? '(none)'}`);
    console.log('  NOT calling the sweep — waiting for production\'s own hourly cron.\n');

    // ---- The wait ----------------------------------------------------------
    const deadline = Date.now() + WAIT_MINUTES * 60_000;
    let after: ReleaseRow | undefined;
    let ticked: string | null = tickBefore;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 60_000));
      const now = await rowsFor(owner.email);
      after = now.find((r) => r.id === target.id);
      ticked = await lastSchedulerRun();
      const mins = Math.round((deadline - Date.now()) / 60_000);
      console.log(`  [${new Date().toISOString().slice(11, 19)}] state=${after?.state} v${after?.version} · last tick ${ticked ?? '-'} · ${mins} min left`);
      if (after && after.state !== 'armed') break;
    }

    R.check(
      'a real cron tick happened while waiting',
      ticked !== tickBefore,
      `${tickBefore ?? '-'} -> ${ticked ?? '-'}`,
    );

    R.check(
      '🔴 THE POINT: the sweep moved the trigger OFF armed with nobody calling it',
      after !== undefined && after.state !== 'armed',
      `armed -> ${after?.state}`,
    );

    /*
      🔴 THE RESTING STATE IS `grace`, NOT `pending`, AND THAT IS CORRECT.

      The first run of this walk asserted `state === 'pending'` and FAILED
      against a system doing exactly the right thing — worth keeping as a comment
      because the mistake is an easy one to make twice.

      `GRACE_WINDOW_MS` is 0. `armOne` transitions armed -> pending AND stamps
      `grace_ends_at = now + graceWindowMs(type)`, which for a zero window is
      already elapsed; `resolveElapsedGrace`, called by the SAME cron request
      immediately after the sweep, then advances pending -> grace. So one tick
      produces two transitions and the version moves by two.

      PENDING is therefore real but momentary — it exists in the audit chain and
      never in a poll. Asserting on the resting state alone would have been
      asserting on a race with the poll interval. The audit log is the honest
      witness, which is what the check below reads.
    */
    const audit = await query<{ action: string; actor: string }>(
      `SELECT a.action, a.actor FROM audit_log a JOIN users u ON u.id = a.owner_id
        WHERE u.email = $1 ORDER BY a.seq DESC LIMIT 8`,
      [owner.email],
    );
    const actions = audit.rows.map((a) => `${a.actor}:${a.action}`);

    R.check(
      '🔴 ARMED -> PENDING is in the hash-chained audit log, written by `system`',
      audit.rows.some((a) => a.action === 'release_transition_pending' && a.actor === 'system'),
      actions.join(' ') || 'no entries',
    );

    R.check(
      'and PENDING -> GRACE followed in the same tick (GRACE_WINDOW_MS is 0)',
      audit.rows.some((a) => a.action === 'release_transition_grace' && a.actor === 'system'),
      `resting state ${after?.state}`,
    );

    R.check(
      'the OCC version advanced by TWO — one bump per transition',
      after !== undefined && Number(after.version) === Number(target.version) + 2,
      `v${target.version} -> v${after?.version}`,
    );
  } finally {
    await closeAll([
      { actor: verifier, kind: 'contact' },
      { actor: owner, kind: 'owner' },
    ]);
    R.finish();
    await closeAllPools();
  }
}

main().catch(async (err) => {
  console.error(`\nERROR: ${String(err)}`);
  process.exitCode = 1;
  await closeAllPools();
});
