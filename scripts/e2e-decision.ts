/**
 * B15.2 — the verifier says NO, and the release stops. Never exercised on production.
 *
 * 🔴 WHAT THIS CLOSES. `README.md` lists "verifier deny/abstain" at
 * `live-proven`. It was not: `submitConfirmation`'s deny and abstain branches
 * and the J7-R7 halt had unit tests calling the function and nothing else, and
 * the register has said so since 2026-08-28 —
 * `deferred.shipped-but-unproven-release-guards`, B15.2. This is the walk.
 *
 * WHY THE HALT IN PARTICULAR IS WORTH A LIVE WALK. It is the only mechanism in
 * the product by which a human can STOP a release that the machinery has already
 * started, and it is arithmetic layered on a CAS increment layered on a guarded
 * state reset — three things that unit tests exercise separately and production
 * exercises together. It also has a history of being wrong in a way that made it
 * unreachable rather than incorrect: until 2026-08-13 `M` counted the whole
 * roster rather than the ELIGIBLE pool, so on any roster with an unverified name
 * the halt threshold could never be crossed. Both eligible verifiers deny, the
 * quorum is factually dead, and the release waits forever. That bug passed every
 * unit test it had, because the tests supplied M directly.
 *
 * THE THREE THINGS ASSERTED, and each is chosen because it discriminates:
 *
 *   1. ABSTAIN IS NOT A QUIET DENIAL. A 2-of-2 quorum with one abstention must
 *      stay open. If abstain were folded into the denial count — the obvious
 *      simplification, and the one a refactor would reach for — that same
 *      abstention would halt the release. So this asserts the release is STILL
 *      OPEN after it, which is the assertion that fails if the two are ever
 *      conflated.
 *
 *   2. 🔴 ONE DENIAL ON A 2-OF-2 HALTS IT, and the row goes back to ARMED. Two
 *      eligible verifiers, two required: one objection makes the quorum
 *      arithmetically unreachable and `release_halted_by_denial` is written by
 *      `system`. This is J7-R7 and it has never happened outside a unit test.
 *
 *   3. AN UNCONFIRMED VERIFIER CANNOT HALT ANYTHING. §4.3's gate is checked
 *      BEFORE the decision branch precisely so a denial from an unverified party
 *      cannot stop a release either — the same gap facing the other way. Their
 *      answer is recorded in the audit log and NOT in `verifier_confirmations`,
 *      and that placement is load-bearing: the idempotency intent-read keys on
 *      that table, so a non-counting row there would make every later attempt
 *      return `duplicate` and the person could never count once verified.
 *      This walk asserts the ledger stays empty for them.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * PRODUCTION cluster — Relay has no dev database. One owner signup (against the
 * 10-per-hour ceiling), three contacts claimed rather than signed up, all closed
 * in a `finally`. Run `npm run verify:orphans` after.
 *
 * ⚠️ NO CRON IS INVOLVED AND NOTHING IS BACKDATED. Every transition here is
 * driven by a real HTTP call from a real actor, which is why this walk takes
 * seconds rather than the hour `e2e-sweep` needs.
 *
 *   npm run dev
 *   npm run verify:decision
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R5, J7-R7, J7-R8, J7-R9, J7-R10; B15.2
 */
import { issueVerifierToken } from '../lib/auth/verifier-token';
import { TIMELINE_ACTIONS } from '../lib/release/verifier-context';
import { query, closeAllPools } from '../lib/db/connection';
import { Actor, Results, signUp, signIn, claim, closeAll, undeliverable, BASE } from './walk-harness';

const R = new Results();

function idOf(body: Record<string, unknown>): string {
  return String(
    (body as { id?: string }).id ??
      (body as { verifier?: { id: string } }).verifier?.id ??
      '',
  );
}

interface ReleaseRow {
  id: string;
  state: string;
  received_confirmations: number;
  received_denials: number | null;
  version: number;
}

async function releaseRow(ownerEmail: string): Promise<ReleaseRow | undefined> {
  const r = await query<ReleaseRow>(
    `SELECT rs.id, rs.state, rs.received_confirmations, rs.received_denials, rs.version
       FROM release_state rs JOIN users u ON u.id = rs.owner_id
      WHERE u.email = $1 AND rs.trigger_type = 'emergency'
      LIMIT 1`,
    [ownerEmail],
  );
  return r.rows[0];
}

async function actions(ownerEmail: string): Promise<string[]> {
  const r = await query<{ actor: string; action: string }>(
    `SELECT a.actor, a.action FROM audit_log a JOIN users u ON u.id = a.owner_id
      WHERE u.email = $1 ORDER BY a.seq ASC`,
    [ownerEmail],
  );
  return r.rows.map((x) => `${x.actor}:${x.action}`);
}

/** Rows in the quorum LEDGER for one verifier — deliberately not the audit log. */
async function ledgerRows(releaseStateId: string, verifierId: string): Promise<string[]> {
  const r = await query<{ decision: string | null }>(
    `SELECT decision FROM verifier_confirmations
      WHERE release_state_id = $1 AND verifier_id = $2`,
    [releaseStateId, verifierId],
  );
  return r.rows.map((x) => x.decision ?? '(null)');
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const owner = new Actor('Decision Owner', undeliverable(`relay-dec-owner-${stamp}@relay.test`));
  const v1 = new Actor('Verifier One', undeliverable(`relay-dec-v1-${stamp}@relay.test`));
  const v2 = new Actor('Verifier Two', undeliverable(`relay-dec-v2-${stamp}@relay.test`));
  const v3 = new Actor('Verifier Three', undeliverable(`relay-dec-v3-${stamp}@relay.test`));

  console.log(
    `base=${BASE}\n  owner=${owner.email}\n` +
      `  v1=${v1.email} (confirmed)\n  v2=${v2.email} (confirmed)\n  v3=${v3.email} (claimed, NOT confirmed)\n`,
  );

  try {
    await signUp(owner);
    await signIn(owner);

    /*
      Three verifiers named, all three claimed, only TWO confirmed. The third is
      the §4.3 case and its set-up is the whole point of it: somebody who holds a
      standby account and could plausibly reach the door, but whom the owner has
      not verified. `countEligibleVerifiers` therefore reads M = 2, not 3, which
      is what makes one denial enough to halt a 2-of-2.
    */
    const ids: string[] = [];
    for (const [i, actor] of [v1, v2, v3].entries()) {
      const ver = await owner.post('/api/verifiers', {
        name: `Verifier ${i + 1}`,
        email: actor.email,
        phone: null,
        relationship: 'physician',
      });
      const vid = idOf(ver.body);
      ids.push(vid);
      const inv = await owner.post('/api/invitations', { personId: vid, personType: 'verifier' });
      await claim(actor, String((inv.body as { claimCode?: string }).claimCode));
      if (i < 2) await owner.post(`/api/people/${vid}/confirm`, { personType: 'verifier' });
    }
    R.check('three verifiers named and claimed', ids.every(Boolean), ids.join(' '));

    const states = await query<{ standby_state: string | null }>(
      `SELECT v.standby_state FROM verifiers v JOIN users u ON u.id = v.owner_id
        WHERE u.email = $1 ORDER BY v.created_at`,
      [owner.email],
    );
    const confirmed = states.rows.filter((s) => s.standby_state === 'confirmed').length;
    R.check(
      'exactly TWO are confirmed — so the eligible pool M is 2, not 3',
      confirmed === 2,
      states.rows.map((s) => s.standby_state ?? 'null').join(','),
    );

    const cfg = await owner.put('/api/triggers/emergency/config', { required_confirmations: 2 });
    R.check('a 2-of-2 quorum is configured', cfg.status === 200, `HTTP ${cfg.status} ${JSON.stringify(cfg.body)}`);

    const fired = await owner.post('/api/triggers/emergency/initiate', {});
    R.check('the owner fires an emergency', fired.status === 200, `HTTP ${fired.status}`);

    let row = await releaseRow(owner.email);
    if (!row) throw new Error('no release_state row after initiate');
    R.check(
      'the release is in GRACE — the confirmable window is open',
      row.state === 'grace',
      `state=${row.state} v${row.version}`,
    );
    const releaseId = row.id;

    /*
      🔴 B15.5 THROUGH THE REAL ROUTE. `buildVerifierContext` gained a rewritten
      audit read on 2026-08-30 — two keyings in one statement, with `= ANY()`
      over two text arrays — and until this call it had run against a MOCKED
      `query` and nothing else. A SQL or type error there would not have shown up
      in any test; it would have 500d on the verifier decision page, which is the
      highest-stakes screen in the product, during somebody's emergency.

      So the walk fetches the real `GET /api/verify/<token>` and asserts the
      timeline actually carries the release event that just happened. That
      proves the `entity_id` half of the new query returns rows through the real
      stack against the real engine.

      ⚠️ IT CANNOT PROVE THE REMINDER HALF, and saying so is the honest end of
      it: a reminder row is written only on successful delivery, and this owner
      is on a reserved TLD. The reminder half is covered by the unit tests that
      pin the query parameters, and by the fact that both branches are one
      statement — if the statement executes, both branches parsed.
    */
    const ctxRes = await v1.call(`/api/verify/${await issueVerifierToken(ids[0], releaseId)}`);
    const ctx = ctxRes.body as {
      ownerLabel?: string;
      escalationHistory?: { action: string; ts: string }[];
      itemCount?: number;
    };
    R.check(
      'the verifier decision context renders through the real route',
      ctxRes.status === 200 && Boolean(ctx.ownerLabel),
      `HTTP ${ctxRes.status} ownerLabel=${String(ctx.ownerLabel)}`,
    );
    R.check(
      '🔴 the rewritten audit read returns the release event — the entity_id half works on DSQL',
      (ctx.escalationHistory ?? []).some((h) => h.action === 'release_transition_pending'),
      (ctx.escalationHistory ?? []).map((h) => h.action).join(',') || 'empty timeline',
    );
    R.check(
      'and every action it returned has a sentence on the screen, not a raw identifier',
      (ctx.escalationHistory ?? []).every((h) => TIMELINE_ACTIONS.includes(h.action)),
      (ctx.escalationHistory ?? []).map((h) => h.action).join(',') || 'none',
    );

    // ================= PART 1: abstaining is not a quiet denial ==============
    const abstained = await owner.post(`/api/triggers/${releaseId}/confirm`, {
      verifier_token: await issueVerifierToken(ids[0], releaseId),
      method: 'app',
      decision: 'abstain',
    });
    const ab = abstained.body as { status?: string };
    R.check(
      'V1 ABSTAINS and it is recorded',
      abstained.status === 200 && ab.status === 'recorded',
      `HTTP ${abstained.status} ${ab.status ?? ''}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'an abstention counts toward NEITHER side — no confirmation, no denial',
      Number(row?.received_confirmations) === 0 && Number(row?.received_denials ?? 0) === 0,
      `confirmations=${row?.received_confirmations} denials=${row?.received_denials ?? 0}`,
    );

    /*
      🔴 THE DISCRIMINATING ASSERTION. On a 2-of-2 with M=2, ONE denial halts.
      If abstain were folded into the denial count — the simplification a
      refactor reaches for, since both are "not a confirmation" — this release
      would now be back at ARMED. It is still open, so they are genuinely
      different things and not merely differently named.
    */
    R.check(
      '🔴 the release is STILL OPEN — an abstention is not a denial in disguise',
      row?.state === 'grace',
      `state=${row?.state}`,
    );

    R.check(
      'the ledger records the abstention, so the owner can see it happened',
      (await ledgerRows(releaseId, ids[0])).includes('abstain'),
      (await ledgerRows(releaseId, ids[0])).join(',') || 'no rows',
    );

    let log = await actions(owner.email);
    R.check(
      'verifier_abstained is in the hash-chained audit log',
      log.some((a) => a.endsWith(':verifier_abstained')),
      log.filter((a) => a.includes('verifier')).join(' ') || 'none',
    );

    // ================= PART 2: the denial, and the halt ======================
    const denied = await owner.post(`/api/triggers/${releaseId}/confirm`, {
      verifier_token: await issueVerifierToken(ids[1], releaseId),
      method: 'app',
      decision: 'deny',
    });
    const dn = denied.body as { status?: string; received?: number; required?: number };
    R.check(
      '🔴 THE POINT: V2 DENIES and the release is HALTED',
      denied.status === 200 && dn.status === 'halted',
      `HTTP ${denied.status} status=${dn.status ?? ''}`,
    );

    /*
      🔴 THE COUNTER IS ZERO HERE, AND THAT IS THE PRODUCT BEING RIGHT.

      This check first asserted `received_denials === 1` and FAILED against a
      system doing exactly the correct thing — kept, because it is the same
      mistake `e2e-sweep` made asserting `state === 'pending'` and it is easy to
      make twice. The halt calls `safeResetToArmed`, and the re-arm CLEARS the
      bookkeeping: `received_confirmations`, `received_denials`, `grace_ends_at`,
      `released_at`. That reset is a fix in its own right — until 2026-08-21 a
      re-armed trigger carried its old votes forward and the next emergency
      opened on a live confirmation plus a stale one. A denial surviving the
      re-arm would be that defect, facing the other way.

      So the counter is momentary, exactly as PENDING is, and the honest witness
      is the audit log — `verifier_denied` records the count AT THE MOMENT OF THE
      DECISION, which is the number that actually decided the halt.
    */
    const denialDetail = await query<{ detail: { denials?: number; outcome?: string } }>(
      `SELECT a.detail FROM audit_log a JOIN users u ON u.id = a.owner_id
        WHERE u.email = $1 AND a.action = 'verifier_denied' ORDER BY a.seq DESC LIMIT 1`,
      [owner.email],
    );
    const detail = denialDetail.rows[0]?.detail ?? {};
    R.check(
      'the denial was counted AT THE MOMENT IT WAS MADE — 1 objection, outcome halt',
      Number(detail.denials) === 1 && detail.outcome === 'halt',
      `denials=${String(detail.denials)} outcome=${String(detail.outcome)}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'and the counter is back to 0 — the re-arm cleared it, so no stale objection carries forward',
      Number(row?.received_denials ?? 0) === 0,
      `denials=${row?.received_denials ?? 0}`,
    );

    /*
      Back to ARMED, not to RELEASED and not stranded in GRACE. This is the
      state the 2026-08-13 M-counting defect could never reach: with M read from
      the whole roster, `2 - 1 < 2` was `3 - 1 < 2`, false, and the release sat
      open forever while its quorum was factually dead.
    */
    R.check(
      '🔴 J7-R7: the release state is back at ARMED — nothing opened',
      row?.state === 'armed',
      `state=${row?.state} v${row?.version}`,
    );

    log = await actions(owner.email);
    R.check(
      'verifier_denied is on the record, attributed to the verifier',
      log.some((a) => a.includes(':verifier_denied')),
      log.filter((a) => a.includes('deni')).join(' ') || 'none',
    );
    R.check(
      'release_halted_by_denial is written by `system`, not by the verifier',
      log.includes('system:release_halted_by_denial'),
      log.filter((a) => a.includes('halt')).join(' ') || 'none',
    );
    R.check(
      'and NOTHING was released — no grant event anywhere in the chain',
      !log.some((a) => a.includes('release_transition_released') || a.includes('access_granted')),
      log.join(' ').slice(0, 160),
    );

    // ============ PART 3: an unconfirmed verifier cannot halt anything =======
    /*
      Re-fire. The halt put the row back to ARMED, which is exactly the state a
      new emergency starts from — so this second release is the ordinary path
      rather than a contrivance, and it doubles as proof that a halted release
      can be started again.
    */
    const refired = await owner.post('/api/triggers/emergency/initiate', {});
    R.check('a halted release can be started again', refired.status === 200, `HTTP ${refired.status}`);

    row = await releaseRow(owner.email);
    R.check(
      'the re-fired release is open, and the denial counter was cleared with the re-arm',
      row?.state === 'grace' && Number(row?.received_denials ?? 0) === 0,
      `state=${row?.state} denials=${row?.received_denials ?? 0}`,
    );

    const stranger = await owner.post(`/api/triggers/${releaseId}/confirm`, {
      verifier_token: await issueVerifierToken(ids[2], releaseId),
      method: 'app',
      decision: 'deny',
    });
    const st = stranger.body as { status?: string };
    R.check(
      '🔴 V3 is claimed but NOT confirmed — their denial does not count',
      stranger.status === 200 && st.status === 'not_counted',
      `HTTP ${stranger.status} status=${st.status ?? ''}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'the denial counter did not move, so the halt arithmetic was never reached',
      Number(row?.received_denials ?? 0) === 0,
      `denials=${row?.received_denials ?? 0}`,
    );
    R.check(
      'and the release is still open — an unverified objection cannot stop it either',
      row?.state === 'grace',
      `state=${row?.state}`,
    );

    /*
      The placement that is load-bearing, and the reason this check reads the
      LEDGER rather than the audit log. `verifier_confirmations` is the quorum
      ledger and the idempotency intent-read keys on it; a non-counting row there
      would make every later attempt by this person return `duplicate`, so once
      the owner verified them they could never count — permanently, and silently.
      That is the ordinary beta sequence, not an edge case.
    */
    R.check(
      '🔴 the quorum LEDGER is untouched for them — so they can still answer once verified',
      (await ledgerRows(releaseId, ids[2])).length === 0,
      (await ledgerRows(releaseId, ids[2])).join(',') || 'no rows (correct)',
    );

    log = await actions(owner.email);
    R.check(
      'their answer IS on the record, in the audit log where the owner can see it',
      log.some((a) => a.endsWith(':verifier_answer_not_counted')),
      log.filter((a) => a.includes('not_counted')).join(' ') || 'none',
    );

    /*
      Leave nothing open behind: stand the second release down before cleanup, so
      the disposable owner cannot be found mid-release between now and their
      deletion a few seconds later.

      ⚠️ THE PATH PARAMETER IS THE RELEASE ID, NOT THE TRIGGER TYPE, and the
      first run of this walk got that wrong. `/initiate` and `/config` take a
      trigger type in `[id]`; `/stand-down` and `/confirm` take a release_state
      UUID. Posting `emergency` here reached the database as
      `WHERE id = 'emergency'` and produced SQLSTATE 22P02, uncaught, so the
      product's ONLY stop control answered 500. The walk was wrong AND the answer
      was wrong: fixed in `standDownTrigger` the same day, with
      `lib/release/stand-down-answers-404-not-500.test.ts` holding it there.
    */
    const down = await owner.post(`/api/triggers/${releaseId}/stand-down`, {});
    R.check('the walk stands its own release down before leaving', down.status === 200, `HTTP ${down.status}`);

    row = await releaseRow(owner.email);
    R.check(
      'nothing is left open — the row rests at ARMED',
      row?.state === 'armed',
      `state=${row?.state}`,
    );

    /*
      The regression the 500 taught, asserted through the real stack rather than
      only in a unit test: a path parameter that cannot name a release is a 404.
      A 500 and a 404 tell an owner in a hurry different things, and only one of
      them is true.
    */
    const wrongShape = await owner.post('/api/triggers/emergency/stand-down', {});
    R.check(
      '🔴 a trigger TYPE where a release id belongs is a 404, not a 500',
      wrongShape.status === 404,
      `HTTP ${wrongShape.status} ${JSON.stringify(wrongShape.body).slice(0, 90)}`,
    );
  } finally {
    await closeAll([
      { actor: v1, kind: 'contact' },
      { actor: v2, kind: 'contact' },
      { actor: v3, kind: 'contact' },
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
