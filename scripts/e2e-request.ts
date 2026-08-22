/**
 * J6 — somebody asks the owner to open the vault, and the owner answers.
 *
 * WHY THIS EXISTS. J6 had no automated cover of any kind. Its most recent
 * evidence was the hand sweep of 2026-08-13, and the sprint of 2026-08-21
 * changed code on this exact path: `assertRequestAllowed` gained a cooling-off
 * after a refusal (J6-R8), and `POST /api/access-requests/[id]/respond` started
 * passing `req` so that answering counts as being alive (J5-R1). Both shipped
 * with unit tests and neither had ever run against the real stack. The three
 * journeys with the least automated cover were three of the ones that moved
 * most recently — `docs/user-journeys.md` says so in its own header, and this
 * walk is half the answer to it.
 *
 * WHAT IT ASSERTS, THROUGH THE REAL STACK:
 *   1. A claimed recipient can ask at all — the door `resolveRequesterFor`
 *      opened. Before it existed, the only actor who could request access was
 *      one who already had it.
 *   2. A signed-in stranger who is NOT on the roster is refused 403, and told
 *      nothing that distinguishes "no such owner" from "not named on it".
 *      This is the enumeration oracle the rejected design would have been.
 *   3. The OWNER is challenged first. No verifier is contacted by the ask.
 *   4. 🔴 Denying stamps liveness. An owner who reads "someone is asking for
 *      access" and answers no has proved they are alive; before 2026-08-21 that
 *      was invisible to `last_active_at` and the heartbeat sweep went on
 *      treating the most present owner in the product as silent.
 *   5. 🔴 THE COOLING-OFF ACTUALLY BITES. A refused contact asking again inside
 *      twelve hours is refused by the product, not merely by a unit test.
 *   6. Denial leaves `release_state` untouched at ARMED — no verifier is
 *      disturbed and nothing is opened.
 *   7. The velocity budget is per RECIPIENT, so a second named contact is not
 *      silenced by the first one's refusal.
 *   8. Approving walks the EXISTING armed -> pending edge rather than inventing
 *      a transition.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * production cluster. Four disposable accounts on RFC 6761 reserved domains,
 * all closed in a `finally`.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/e2e-request.ts
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R1, J6-R2, J6-R4, J6-R5, J6-R8, J6-R9, J5-R1
 */
import { encodeSecretPayload } from '../lib/crypto/secret-payload';
import { CryptoService } from '../lib/crypto/crypto-service';
import { query, closeAllPools } from '../lib/db/connection';
import {
  MAX_REQUESTS_PER_WINDOW,
  REFUSAL_COOLING_OFF_SECONDS,
} from '../lib/release/access-request';
import { Actor, Results, signUp, signIn, claim, closeAll, undeliverable, BASE } from './walk-harness';

const R = new Results();

/** The recipient row id for a named contact, read back from the create reply. */
function idOf(body: Record<string, unknown>): string {
  return String(
    (body as { id?: string }).id ??
      (body as { recipient?: { id: string } }).recipient?.id ??
      (body as { verifier?: { id: string } }).verifier?.id ??
      '',
  );
}

async function lastActiveAt(email: string): Promise<string | null> {
  const res = await query<{ last_active_at: string | null }>(
    `SELECT last_active_at FROM users WHERE email = $1`,
    [email],
  );
  return res.rows[0]?.last_active_at ?? null;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const owner = new Actor('Request Owner', undeliverable(`relay-req-owner-${stamp}@relay.test`));
  const contact = new Actor('Request Contact', undeliverable(`relay-req-contact-${stamp}@relay.test`));
  const second = new Actor('Second Contact', undeliverable(`relay-req-second-${stamp}@relay.test`));
  const stranger = new Actor('Stranger', undeliverable(`relay-req-stranger-${stamp}@relay.test`));

  console.log(
    `base=${BASE}\n  owner=${owner.email}\n  contact=${contact.email}\n` +
      `  second=${second.email}\n  stranger=${stranger.email}\n`,
  );

  try {
    // ---- The vault a request would be about --------------------------------
    await signUp(owner);
    await signIn(owner);

    const ownerRow = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [owner.email]);
    const ownerId = ownerRow.rows[0]?.id;
    if (!ownerId) throw new Error('the owner account did not land in the cluster');

    const recA = await owner.post('/api/recipients', {
      name: 'Sarah',
      email: contact.email,
      relationship: 'child',
      phone: null,
      role: 'recipient',
    });
    const recipientAId = idOf(recA.body);
    R.check('the owner names a recipient', Boolean(recipientAId), `HTTP ${recA.status}`);

    const recB = await owner.post('/api/recipients', {
      name: 'Tom',
      email: second.email,
      relationship: 'child',
      phone: null,
      role: 'recipient',
    });
    const recipientBId = idOf(recB.body);
    R.check('and a second one, so the budget can be shown to be per-person', Boolean(recipientBId), `HTTP ${recB.status}`);

    // ---- Both contacts claim, in calm --------------------------------------
    const invA = await owner.post('/api/invitations', { personId: recipientAId, personType: 'recipient' });
    const claimedA = await claim(contact, String(invA.body.claimCode));
    R.check('the recipient claims a standby account', claimedA.status === 200, `HTTP ${claimedA.status}`);

    const invB = await owner.post('/api/invitations', { personId: recipientBId, personType: 'recipient' });
    const claimedB = await claim(second, String(invB.body.claimCode));
    R.check('the second recipient claims too', claimedB.status === 200, `HTTP ${claimedB.status}`);

    /*
      A signed-in person who is on NOBODY's roster. Signed up as an owner in
      their own right, which is the realistic shape: anyone can make an account.
    */
    await signUp(stranger);
    await signIn(stranger);

    // ---- 2. The enumeration oracle that was designed out --------------------
    const byStranger = await stranger.post('/api/access-requests', {
      owner_id: ownerId,
      trigger_type: 'emergency',
      reason: 'let me in',
    });
    R.check(
      '🔴 a signed-in stranger cannot ask about a vault they are not named on',
      byStranger.status === 403,
      `HTTP ${byStranger.status} ${String(byStranger.body.message ?? '')}`,
    );

    const fabricated = await stranger.post('/api/access-requests', {
      owner_id: '00000000-0000-4000-8000-000000000000',
      trigger_type: 'emergency',
      reason: 'let me in',
    });
    R.check(
      'and an owner_id that exists gives the same answer as one that does not',
      fabricated.status === byStranger.status,
      `real=${byStranger.status} fabricated=${fabricated.status} — indistinguishable, so it is not an oracle`,
    );

    const malformed = await stranger.post('/api/access-requests', {
      owner_id: 'not-a-uuid',
      trigger_type: 'emergency',
      reason: 'x',
    });
    R.check(
      'a malformed owner_id is a 400, not a 500 — a client mistake is not an outage',
      malformed.status === 400,
      `HTTP ${malformed.status}`,
    );

    // ---- 1 + 3. The ask, and who is disturbed by it -------------------------
    const before = await lastActiveAt(owner.email);

    const ask = await contact.post('/api/access-requests', {
      owner_id: ownerId,
      trigger_type: 'emergency',
      reason: "Mum is in hospital and I need the insurance login.\nSecond line, to prove sanitising.",
    });
    const askBody = ask.body as { id?: string; ownerChallenged?: boolean; status?: string; case_id?: string };
    R.check(
      'a claimed recipient CAN ask — the door resolveRequesterFor opened',
      ask.status === 201,
      `HTTP ${ask.status} ${String(ask.body.message ?? '')}`,
    );

    /*
      ⚠️ `ownerChallenged` IS NOT WHAT ITS NAME SAYS, and the first draft of this
      walk asserted it was `true` and went red. The field carries the return of
      `notifyOwnerOfAccessRequest` — whether an EMAIL SENT. Every actor here
      lives on an RFC 6761 reserved domain that the mail seam refuses by design,
      so it reads `false` while the challenge genuinely exists, sits at
      `awaiting_owner`, and is on the owner's own screen.

      The 2026-08-08 hand sweep recorded "201 awaiting_owner with
      ownerChallenged: true" as its evidence that the owner is challenged first.
      That evidence was really about mail delivery. So this walk asserts the
      DURABLE facts instead — the ones that are still true when the ESP is down,
      which is exactly when you would want them to be.
    */
    R.check(
      'the reply reports the mail outcome, and a fixture address cannot receive mail',
      askBody.ownerChallenged === false,
      `ownerChallenged=${String(askBody.ownerChallenged)} — the field is mail success, not "a challenge exists"`,
    );

    const stored = await query<{ status: string; reason: string }>(
      `SELECT status, reason FROM access_requests WHERE owner_id = $1 AND recipient_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [ownerId, recipientAId],
    );
    R.check(
      'the request lands as awaiting_owner',
      stored.rows[0]?.status === 'awaiting_owner',
      `status=${stored.rows[0]?.status}`,
    );
    R.check(
      'the free-text reason is stored with its newlines collapsed',
      !String(stored.rows[0]?.reason ?? '').includes('\n'),
      JSON.stringify(String(stored.rows[0]?.reason ?? '').slice(0, 60)),
    );

    const queued = await owner.call('/api/access-requests');
    const queue = (queued.body as { requests?: Array<{ id: string; recipient_name: string }> }).requests ?? [];
    R.check(
      'the owner sees it in-product, not only by email',
      queue.some((q) => q.id === askBody.id),
      `${queue.length} awaiting`,
    );

    /*
      🔴 NOTHING WAS OPENED AND NOBODY WAS RELEASED. Asserted rather than
      assumed: a request that quietly armed a trigger would be the most
      dangerous possible bug on this path, and it would be invisible to every
      assertion above.
    */
    const armedDuring = await query<{ state: string }>(
      `SELECT state FROM release_state WHERE owner_id = $1`,
      [ownerId],
    );
    R.check(
      'asking opened nothing — no release_state left armed',
      armedDuring.rows.every((r) => r.state === 'armed'),
      armedDuring.rows.length ? armedDuring.rows.map((r) => r.state).join(',') : 'no rows at all',
    );

    // ---- 4. Answering "no" is the strongest "I am here" the product can see --
    const denied = await owner.post(`/api/access-requests/${askBody.id}/respond`, { response: 'deny' });
    R.check('the owner denies the request', denied.status === 200, `HTTP ${denied.status}`);

    const after = await lastActiveAt(owner.email);
    R.check(
      '🔴 THE 2026-08-21 FIX, LIVE: denying counts as checking in',
      Boolean(after) && (!before || Date.parse(after as string) > Date.parse(before)),
      `last_active_at ${before ?? 'null'} -> ${after ?? 'null'}`,
    );

    const deniedRow = await query<{ status: string }>(
      `SELECT status FROM access_requests WHERE id = $1`,
      [String(askBody.id)],
    );
    R.check(
      'the refusal is recorded as denied_by_owner',
      deniedRow.rows[0]?.status === 'denied_by_owner',
      `status=${deniedRow.rows[0]?.status}`,
    );

    // ---- 6. Denial touches nothing ------------------------------------------
    const armedAfter = await query<{ state: string }>(
      `SELECT state FROM release_state WHERE owner_id = $1`,
      [ownerId],
    );
    R.check(
      'denial leaves every release_state at armed',
      armedAfter.rows.every((r) => r.state === 'armed'),
      armedAfter.rows.length ? armedAfter.rows.map((r) => r.state).join(',') : 'no rows at all',
    );

    // ---- 5. The cooling-off, exercised against the product ------------------
    const tooSoon = await contact.post('/api/access-requests', {
      owner_id: ownerId,
      trigger_type: 'emergency',
      reason: 'asking again straight away',
    });
    const coolingMessage = String(tooSoon.body.message ?? '');
    R.check(
      `🔴 THE POINT: refused, so asking again inside ${REFUSAL_COOLING_OFF_SECONDS / 3600}h is refused`,
      tooSoon.status === 400 && /declined/i.test(coolingMessage),
      `HTTP ${tooSoon.status} ${coolingMessage}`,
    );
    /*
      Both refusals in `assertRequestAllowed` are `ValidationError`, so both are
      400 rather than 429 — a deliberate and consistent choice, checked here so
      that a later split into two status codes is a decision rather than a drift.
    */
    R.check(
      'and the refusal names the REAL number of hours, not "a few"',
      /\b\d+\s+hours?\b/.test(coolingMessage) && !/a few/i.test(coolingMessage),
      'vague reassurance manufactures the repeat attempts the rule exists to stop',
    );

    const stillOne = await query<{ n: string }>(
      `SELECT count(*) AS n FROM access_requests WHERE recipient_id = $1`,
      [recipientAId],
    );
    R.check(
      'and the refused ask was not even recorded — the budget is not spent by a blocked attempt',
      Number(stillOne.rows[0]?.n) === 1,
      `${stillOne.rows[0]?.n} row(s)`,
    );

    // ---- 7. Per recipient, not per vault ------------------------------------
    const otherPerson = await second.post('/api/access-requests', {
      owner_id: ownerId,
      trigger_type: 'emergency',
      reason: 'I am the other named contact',
    });
    R.check(
      'the OTHER named contact is not silenced by the first one’s refusal',
      otherPerson.status === 201,
      `HTTP ${otherPerson.status} ${String(otherPerson.body.message ?? '')}`,
    );

    // ---- 8. Approving walks the existing edge -------------------------------
    const approveId = (otherPerson.body as { id?: string }).id;

    /*
      🔴 A FINDING THIS WALK PRODUCED ON ITS FIRST RUN, 2026-08-21, and the
      reason it is asserted rather than fixed here.

      `release_state` rows are provisioned by `POST /api/rules` (and by setting a
      quorum), NOT by naming a recipient. So an owner who has named and invited
      somebody but has not yet written an access rule has NO release_state row —
      and `respondToChallenge`'s approve arm requires one. That owner can be
      asked for access, can DENY perfectly well, and cannot APPROVE: they get a
      400 saying "No release state for that trigger type", which means nothing to
      a person reading it on their phone about their own mother.

      It is reachable in ordinary setup order — name, invite, claim, ask — and
      that is exactly the anxious window this journey is for. Recorded in
      `PROJECT.yaml → deferred → approve-is-unreachable-before-the-first-rule`,
      because whether the fix is to provision on approve or to say something true
      is a product decision and not a walk's to take.

      Asserted BOTH ways: the current behaviour below, then the working path once
      a rule exists. If somebody fixes it, this check goes red and points at the
      register entry rather than silently passing.
    */
    const approveTooEarly = await owner.post(`/api/access-requests/${approveId}/respond`, {
      response: 'approve',
    });
    R.check(
      '🔴 FINDING: with no access rule yet, the owner CANNOT approve — only deny',
      approveTooEarly.status === 400,
      `HTTP ${approveTooEarly.status} "${String(approveTooEarly.body.message ?? '')}" ` +
        `— see deferred → approve-is-unreachable-before-the-first-rule`,
    );

    /*
      Now give the vault the rule it was missing, which is what provisions the
      release_state row, and walk the approve path properly. The request above is
      spent (`claimRequest` moved it out of `awaiting_owner` before it threw), so
      a fresh one is needed — itself worth knowing: a failed approve BURNS the
      request. That is the second half of the same finding.
    */
    const spent = await query<{ status: string }>(
      `SELECT status FROM access_requests WHERE id = $1`,
      [String(approveId)],
    );
    R.check(
      '🔴 and the failed approve BURNED the request — it is no longer answerable',
      spent.rows[0]?.status === 'approved_by_owner',
      `status=${spent.rows[0]?.status} while release_state was never touched`,
    );

    // A rule needs something to point at, and the crypto boundary refuses a raw
    // write (fail-closed, proven by e2e-factors), so this goes the browser's way.
    const svc = new CryptoService(owner.fetchAs());
    const payload = await svc.encryptForUpload(
      encodeSecretPayload([{ kind: 'password', value: 'a rule needs something to point at' }]),
      {
        type: 'login',
        title: 'Something to point a rule at',
        service_name: 'Example',
        category: 'finance',
        criticality: 'high',
      } as never,
    );
    const item = await owner.post('/api/vault/items', payload);
    const itemId = idOf(item.body);
    R.check(
      'the owner stores an item',
      item.status === 201 && Boolean(itemId),
      `HTTP ${item.status} ${JSON.stringify(item.body).slice(0, 200)}`,
    );

    const rule = await owner.post('/api/rules', {
      recipient_id: recipientBId,
      vault_item_id: itemId,
      trigger_type: 'emergency',
      scope: 'view',
      reversible: true,
    });
    R.check(
      'the owner writes their first access rule',
      rule.status === 201,
      `HTTP ${rule.status} ${JSON.stringify(rule.body).slice(0, 200)}`,
    );

    const provisioned = await query<{ state: string }>(
      `SELECT state FROM release_state WHERE owner_id = $1 AND trigger_type = 'emergency'`,
      [ownerId],
    );
    R.check(
      'writing the rule is what provisions the release_state row',
      provisioned.rows[0]?.state === 'armed',
      `state=${provisioned.rows[0]?.state}`,
    );

    const askAgain = await second.post('/api/access-requests', {
      owner_id: ownerId,
      trigger_type: 'emergency',
      reason: 'asking again now that a rule exists',
    });
    R.check('the second contact asks again', askAgain.status === 201, `HTTP ${askAgain.status}`);

    const approved = await owner.post(`/api/access-requests/${(askAgain.body as { id?: string }).id}/respond`, {
      response: 'approve',
    });
    R.check(
      'and NOW the owner can approve',
      approved.status === 200,
      `HTTP ${approved.status} ${String(approved.body.message ?? '')}`,
    );

    /*
      ⚠️ THE EXPECTED STATE IS `grace`, NOT `pending`, and the first draft of this
      walk asserted `pending` and went red. `respondToChallenge` takes BOTH
      existing edges in one call — ARMED -> PENDING with verifier notification
      suppressed, then PENDING -> GRACE with the quorum auto-satisfied, because
      the owner consenting is strictly stronger than a quorum of third parties
      attesting on their behalf. Two existing transitions, no new one.
    */
    const opened = await query<{ state: string; received_confirmations: number }>(
      `SELECT state, received_confirmations FROM release_state
        WHERE owner_id = $1 AND trigger_type = 'emergency'
        ORDER BY created_at DESC LIMIT 1`,
      [ownerId],
    );
    R.check(
      'approval walks armed -> pending -> grace on EXISTING edges, not a new one',
      opened.rows[0]?.state === 'grace',
      `state=${opened.rows[0]?.state}`,
    );
    /*
      🔴 AND IT STOPS THERE. Owner consent satisfies the quorum; it does not skip
      the grace window. `resolveElapsedGrace` runs from the hourly cron, so the
      owner still has the interval in which to stand it down — which is the whole
      protection, and the thing an "approve" button could plausibly have burned
      through by going straight to RELEASED.
    */
    R.check(
      'and it does NOT skip to released — the owner keeps their window',
      opened.rows[0]?.state !== 'released',
      `state=${opened.rows[0]?.state}, so stand-down is still available`,
    );

    // ---- The velocity budget still exists behind the cooling-off ------------
    R.check(
      `the velocity budget is declared as ${MAX_REQUESTS_PER_WINDOW} per 24h`,
      MAX_REQUESTS_PER_WINDOW === 3,
      'read from lib/release/access-request.ts, not copied into prose',
    );

    /*
      ⚠️ WHAT THIS WALK DELIBERATELY DOES NOT PROVE, stated so the gap is visible
      rather than accidental: the ESCALATION to verifiers when the owner does not
      answer inside the challenge window. That path is driven by elapsed time and
      the heartbeat cron, and a walk that slept out an emergency's window would
      take longer than the whole gate. It stays unit-tested (`escalation.test.ts`)
      and hand-walked. Recorded here rather than left for a reader to assume.
    */
  } finally {
    await closeAll([
      { actor: contact, kind: 'contact' },
      { actor: second, kind: 'contact' },
      { actor: stranger, kind: 'owner' },
      { actor: owner, kind: 'owner' },
    ]);
  }

  R.finish();
}

main()
  .catch((e) => {
    console.error('ERROR:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
