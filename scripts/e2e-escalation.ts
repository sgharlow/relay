/**
 * B15.3 — J6 step 4c: the owner never answered, so the verifiers get asked.
 *
 * 🔴 WHAT THIS CLOSES. `escalateLapsedRequest` is the transition that makes the
 * product work in the case it is actually sold for. `CHALLENGE_WINDOW_SECONDS`
 * was documented as "how long the owner gets to answer before verifiers are
 * contacted", `access_requests.expires_at` was stored NOT NULL and handed back to
 * the client, and for a long time NOTHING EVER READ IT — so when the owner was
 * incapacitated, a recipient's request sat in `awaiting_owner` forever and the
 * only working path was waiting out the whole heartbeat interval. It had been
 * read as a notification problem; it was a missing state transition.
 *
 * The transition exists now. It had never been walked. The register has said so
 * since 2026-08-28 (`deferred.shipped-but-unproven-release-guards`, B15.3).
 *
 * TWO PATHS FIRE IT, AND THIS WALKS BOTH, because they are different code with
 * different failure modes and only one of them is on the roadmap's line:
 *
 *   --mode read  (default) THE DERIVE-ON-READ HALF. `standby-resolve.ts` calls
 *                `escalateLapsedRequestsForOwners` when somebody loads their
 *                standby dashboard — §4.4's original design, "the person looking
 *                is usually the person waiting". Deterministic, seconds, no cron.
 *                ⚠️ Its call is wrapped in `.catch(() => {})` so rung 0 renders
 *                even when escalation cannot run — a correct choice that makes
 *                this path's failure mode COMPLETELY silent: the dashboard looks
 *                right and the release never advances.
 *
 *   --mode cron  THE SCHEDULED HALF. `escalateLapsedRequests` from the hourly
 *                heartbeat, with nothing local calling it — CRON_SECRET lives
 *                only in Vercel. This is the one the roadmap names, and it costs
 *                up to an hour of real waiting.
 *
 * ⚠️ ONE COLUMN IS BACKDATED, and it is the same concession `e2e-sweep` makes.
 * `expires_at` is pushed into the past by an UPDATE scoped to this walk's own
 * request id, because the alternative is waiting the emergency challenge window
 * of two hours. Everything after the backdate — the query that finds it, the CAS
 * claim, both transitions, the audit entries, the verifier notices — is the real
 * thing.
 *
 * 🔴 SAFETY, IN THE CRON MODE ESPECIALLY. `escalateLapsedRequests` is NOT scoped
 * to one owner: it sweeps every request whose window has lapsed. So this walk
 * REFUSES TO RUN if anybody else already has a lapsed `awaiting_owner` request,
 * because the tick it waits for would escalate theirs too — and escalating a
 * real person's request to their real verifiers is not a walk. Checked before a
 * single row is written.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * PRODUCTION cluster. One owner signup against the 10-per-hour ceiling; the
 * recipient and verifier are claimed rather than signed up. All closed in a
 * `finally`. Run `npm run verify:orphans` after.
 *
 *   npm run dev
 *   npm run verify:escalation
 *   npm run verify:escalation -- --mode cron --wait 75
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R2, J6-R5, J6-R7; B15.3
 */
import { encodeSecretPayload } from '../lib/crypto/secret-payload';
import { CryptoService } from '../lib/crypto/crypto-service';
import { query, closeAllPools } from '../lib/db/connection';
import { Actor, Results, signUp, signIn, claim, closeAll, undeliverable, BASE } from './walk-harness';

const R = new Results();

const MODE: 'read' | 'cron' = (() => {
  const i = process.argv.indexOf('--mode');
  return i !== -1 && process.argv[i + 1] === 'cron' ? 'cron' : 'read';
})();

const WAIT_MINUTES = (() => {
  const i = process.argv.indexOf('--wait');
  const n = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : 75;
})();

function idOf(body: Record<string, unknown>): string {
  return String(
    (body as { id?: string }).id ??
      (body as { recipient?: { id: string } }).recipient?.id ??
      (body as { verifier?: { id: string } }).verifier?.id ??
      '',
  );
}

interface ReleaseRow {
  id: string;
  state: string;
  initiated_by: string | null;
  received_confirmations: number;
  version: number;
}

async function releaseRow(ownerEmail: string): Promise<ReleaseRow | undefined> {
  const r = await query<ReleaseRow>(
    `SELECT rs.id, rs.state, rs.initiated_by, rs.received_confirmations, rs.version
       FROM release_state rs JOIN users u ON u.id = rs.owner_id
      WHERE u.email = $1 AND rs.trigger_type = 'emergency'
      LIMIT 1`,
    [ownerEmail],
  );
  return r.rows[0];
}

async function requestStatus(requestId: string): Promise<string | undefined> {
  const r = await query<{ status: string }>(`SELECT status FROM access_requests WHERE id = $1`, [
    requestId,
  ]);
  return r.rows[0]?.status;
}

async function actions(ownerEmail: string): Promise<string[]> {
  const r = await query<{ actor: string; action: string }>(
    `SELECT a.actor, a.action FROM audit_log a JOIN users u ON u.id = a.owner_id
      WHERE u.email = $1 ORDER BY a.seq ASC`,
    [ownerEmail],
  );
  return r.rows.map((x) => `${x.actor}:${x.action}`);
}

/** Everybody else whose challenge window has already lapsed. */
async function othersLapsed(exceptEmail: string): Promise<string[]> {
  const r = await query<{ email: string }>(
    `SELECT DISTINCT u.email
       FROM access_requests ar JOIN users u ON u.id = ar.owner_id
      WHERE ar.status = 'awaiting_owner' AND ar.expires_at <= now() AND u.email <> $1`,
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
  const owner = new Actor('Escalation Owner', undeliverable(`relay-esc-owner-${stamp}@relay.test`));
  const kin = new Actor('Escalation Recipient', undeliverable(`relay-esc-kin-${stamp}@relay.test`));
  const doc = new Actor('Escalation Verifier', undeliverable(`relay-esc-doc-${stamp}@relay.test`));

  console.log(
    `base=${BASE}  mode=${MODE}\n  owner=${owner.email}\n  recipient=${kin.email}\n  verifier=${doc.email}\n`,
  );

  /*
    THE REFUSAL COMES FIRST, before a single row is written — the rule
    `e2e-sweep` set. In cron mode the tick this walk waits for sweeps EVERY
    lapsed request, so somebody else's would be escalated to their real
    verifiers to prove a point about this one.
  */
  const blockers = await othersLapsed(owner.email);
  R.check(
    'no OTHER owner has a lapsed challenge window — the escalation will not touch anybody real',
    blockers.length === 0,
    blockers.length ? `REFUSING: ${blockers.join(', ')} would also escalate` : 'nobody else is lapsed',
  );
  if (blockers.length) {
    console.log('\n🔴 Refused. Somebody real has an unanswered request past its window.\n');
    process.exitCode = 1;
    return;
  }

  try {
    await signUp(owner);
    await signIn(owner);

    // ---- A vault with something in it, and a circle around it ---------------
    const svc = new CryptoService(owner.fetchAs());
    const payload = await svc.encryptForUpload(
      encodeSecretPayload([
        { kind: 'username', value: 'held.account@example.test' },
        { kind: 'password', value: 'nobody-answered-the-door-4417' },
      ]),
      {
        type: 'login',
        title: 'The account nobody could ask about',
        service_name: 'Example',
        category: 'finance',
        criticality: 'critical',
      } as never,
    );
    const created = await owner.post('/api/vault/items', payload);
    const itemId = idOf(created.body);
    R.check('the owner stores a real, encrypted item', Boolean(itemId), `HTTP ${created.status}`);

    const rec = await owner.post('/api/recipients', {
      name: 'Next of kin', email: kin.email, relationship: 'child', phone: null, role: 'recipient',
    });
    const recipientId = idOf(rec.body);
    await owner.post('/api/rules', {
      recipient_id: recipientId,
      vault_item_id: itemId,
      trigger_type: 'emergency',
      scope: 'view',
      reversible: true,
    });

    const ver = await owner.post('/api/verifiers', {
      name: 'Dr Reyes', email: doc.email, phone: null, relationship: 'physician',
    });
    const verifierId = idOf(ver.body);
    const vinv = await owner.post('/api/invitations', { personId: verifierId, personType: 'verifier' });
    await claim(doc, String((vinv.body as { claimCode?: string }).claimCode));
    const conf = await owner.post(`/api/people/${verifierId}/confirm`, { personType: 'verifier' });
    R.check('a CONFIRMED verifier stands by', conf.status === 200, `HTTP ${conf.status}`);

    const rinv = await owner.post('/api/invitations', { personId: recipientId, personType: 'recipient' });
    const claimed = await claim(kin, String((rinv.body as { claimCode?: string }).claimCode));
    R.check('the recipient claims a standby account in calm', claimed.status === 200, `HTTP ${claimed.status}`);

    const ownerRow = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      owner.email,
    ]);
    const ownerId = ownerRow.rows[0]?.id ?? '';
    R.check('the owner id is readable, so the recipient can name whose vault they mean', Boolean(ownerId), ownerId);

    const cfg = await owner.put('/api/triggers/emergency/config', { required_confirmations: 1 });
    R.check('a 1-of-1 quorum is configured', cfg.status === 200, `HTTP ${cfg.status} ${JSON.stringify(cfg.body)}`);

    let row = await releaseRow(owner.email);
    R.check('the trigger rests at ARMED, which is what a lapse acts on', row?.state === 'armed', `state=${row?.state}`);
    const versionBefore = Number(row?.version ?? 0);

    // ---- The ask, and the silence -------------------------------------------
    const ask = await kin.post('/api/access-requests', {
      owner_id: ownerId,
      trigger_type: 'emergency',
      reason: 'They are in hospital and I cannot reach them.',
    });
    const requestId = idOf(ask.body as Record<string, unknown>);
    R.check('the recipient asks for access', ask.status === 201 && Boolean(requestId), `HTTP ${ask.status} ${JSON.stringify(ask.body).slice(0, 120)}`);

    R.check(
      'the OWNER is challenged first — the request waits on them, not on a verifier',
      (await requestStatus(requestId)) === 'awaiting_owner',
      `status=${await requestStatus(requestId)}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'and no verifier has been disturbed — the trigger has not moved',
      row?.state === 'armed',
      `state=${row?.state}`,
    );

    /*
      The one mutation that is not the product's own path, scoped to this walk's
      own request by id. The emergency challenge window is two hours; the
      alternative to backdating is waiting them out.
    */
    await query(`UPDATE access_requests SET expires_at = now() - INTERVAL '1 minute' WHERE id = $1`, [
      requestId,
    ]);
    const lapsed = await query<{ lapsed: boolean }>(
      `SELECT (status = 'awaiting_owner' AND expires_at <= now()) AS lapsed
         FROM access_requests WHERE id = $1`,
      [requestId],
    );
    R.check(
      "the challenge window has lapsed by the sweep's own predicate",
      lapsed.rows[0]?.lapsed === true,
      'awaiting_owner and past expires_at',
    );

    // ---- The escalation -----------------------------------------------------
    if (MODE === 'read') {
      /*
        §4.4's derive-on-read: the VERIFIER loads their standby dashboard, and
        the lapse fires because somebody is looking. Note who is looking — a
        person who has not been told anything yet, which is the whole point of
        rung 0.
      */
      const dash = await doc.call('/api/standby');
      R.check(
        'the verifier loads their standby dashboard',
        dash.status === 200,
        `HTTP ${dash.status}`,
      );
    } else {
      const tickBefore = await lastSchedulerRun();
      console.log(`\n  last scheduler run before waiting: ${tickBefore ?? '(none)'}`);
      console.log("  NOT calling the sweep — waiting for production's own hourly cron.\n");

      const deadline = Date.now() + WAIT_MINUTES * 60_000;
      let ticked: string | null = tickBefore;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 60_000));
        ticked = await lastSchedulerRun();
        const status = await requestStatus(requestId);
        const mins = Math.round((deadline - Date.now()) / 60_000);
        console.log(
          `  [${new Date().toISOString().slice(11, 19)}] request=${status} · last tick ${ticked ?? '-'} · ${mins} min left`,
        );
        if (status !== 'awaiting_owner') break;
      }
      R.check(
        'a real cron tick happened while waiting',
        ticked !== tickBefore,
        `${tickBefore ?? '-'} -> ${ticked ?? '-'}`,
      );
    }

    R.check(
      `🔴 THE POINT: the unanswered request was ESCALATED${MODE === 'cron' ? ' by a cron nobody called' : ' the moment somebody looked'}`,
      (await requestStatus(requestId)) === 'escalated',
      `status=${await requestStatus(requestId)}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'the release opened a confirmable window — ARMED is behind it now',
      row?.state === 'grace',
      `state=${row?.state} v${row?.version}`,
    );

    /*
      🔴 THE ASSERTION THAT SEPARATES A LAPSE FROM CONSENT, and the one the
      module's header says must never be copied from the owner-consent path.
      `respondToChallenge` auto-satisfies the quorum on approval, deliberately:
      an owner agreeing is strictly stronger than third parties attesting on
      their behalf. A LAPSE IS THE OPPOSITE — it is the ABSENCE of a signal. So
      escalation opens the window and leaves `received_confirmations` alone, and
      the verifier must actually answer. If this ever reads 1, silence has been
      promoted to consent.
    */
    R.check(
      '🔴 the quorum was NOT auto-satisfied — silence is not consent',
      Number(row?.received_confirmations) === 0,
      `received_confirmations=${row?.received_confirmations}`,
    );

    R.check(
      'the audit names the LAPSE rather than a person, so "nobody answered" stays distinguishable from "they agreed"',
      String(row?.initiated_by ?? '') === `challenge_lapsed:${requestId}`,
      `initiated_by=${row?.initiated_by ?? 'null'}`,
    );

    R.check(
      'the OCC version advanced by TWO — one bump per transition, no new edge invented',
      Number(row?.version) === versionBefore + 2,
      `v${versionBefore} -> v${row?.version}`,
    );

    const log = await actions(owner.email);
    R.check(
      'request_escalated_to_verifiers is written by system:challenge_lapsed',
      log.includes('system:challenge_lapsed:request_escalated_to_verifiers'),
      log.filter((a) => a.includes('escalat')).join(' ') || 'none',
    );
    R.check(
      'both halves of the transition are in the hash-chained log, written by `system`',
      log.includes('system:release_transition_pending') && log.includes('system:release_transition_grace'),
      log.filter((a) => a.includes('release_transition')).join(' ') || 'none',
    );
    R.check(
      'and nothing was RELEASED — the verifier still has to answer',
      !log.some((a) => a.includes('release_transition_released')),
      log.filter((a) => a.includes('released')).join(' ') || 'nothing released (correct)',
    );

    /*
      The defect that made the audit entry a lie until 2026-08-21: the state
      machine advanced, `request_escalated_to_verifiers` was written, and the
      verifiers' inboxes stayed empty — so the window ran down while the only
      people who could act on it had no idea it had opened. The send itself is
      refused here (reserved TLD, correctly), so what is asserted is that the
      verifier is now ASKED — their standby view shows something open.
    */
    const standby = await doc.call('/api/standby');
    const open = (standby.body as { anythingOpen?: boolean }).anythingOpen;
    R.check(
      "🔴 the verifier's own standby view now shows something open — they were actually brought in",
      standby.status === 200 && open === true,
      `HTTP ${standby.status} anythingOpen=${String(open)}`,
    );

    // Leave nothing open behind.
    const down = await owner.post(`/api/triggers/${row!.id}/stand-down`, {});
    R.check('the walk stands its own release down before leaving', down.status === 200, `HTTP ${down.status}`);
  } finally {
    await closeAll([
      { actor: kin, kind: 'contact' },
      { actor: doc, kind: 'contact' },
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
