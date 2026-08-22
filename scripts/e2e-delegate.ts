/**
 * J3 — an adult child sets a parent's vault up for them, with the parent's consent.
 *
 * WHY THIS EXISTS. J3 had no automated cover. Its most recent evidence was the
 * hand sweep of 2026-08-13, and the sprint of 2026-08-21 narrowed delegate scopes
 * to what the handlers actually honour — a change on this exact path, shipped
 * with unit tests and never run against the real stack.
 *
 * THE THING THIS JOURNEY IS REALLY ABOUT is that a delegation is INERT until
 * consent is recorded. Everything else here is scaffolding for that one
 * assertion: a helper who has been named but not consented to must be able to do
 * nothing at all, and the product must refuse them at the trust boundary rather
 * than by hiding a button.
 *
 * WHAT IT ASSERTS, THROUGH THE REAL STACK:
 *   1. Only somebody already IN the circle who has CLAIMED can be made a helper.
 *      No email lookup, no account minted as a side effect — so this path is not
 *      an oracle for whether an address has a Relay account.
 *   2. 🔴 A PENDING delegation grants NOTHING. The helper's proposal is refused
 *      while consent is unrecorded, at the API and not merely in the UI.
 *   3. Consent by PAPER activates it — a parent without a smartphone is not a
 *      blocker (J3-R3) — and an unrecognised method is refused, not coerced.
 *   4. 🔴 The consent artifact READS BACK. `consent_artifacts` was written by
 *      `recordConsent` and selected by nothing until 2026-08-12, so the consent
 *      screen's own promise — "this is kept as a record" — was kept by the
 *      database and never by the product.
 *   5. The active helper can propose, and the proposal lands in the owner's
 *      queue rather than taking effect.
 *   6. 🔴 SCOPES ARE NARROWED AT READ TIME, not merely at write time. Rows made
 *      before 2026-08-12 still carry `policies:propose` in the database; the
 *      grant must be dropped when the row is read, or a retired capability comes
 *      back for every old delegation.
 *   7. What the helper did is reviewable (J3-R8) — the digest is derived from
 *      the audit chain, so it cannot disagree with the record.
 *   8. Revocation actually removes the capability, immediately.
 *   9. Self-delegation is refused — an owner cannot be their own helper.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * production cluster. Three disposable accounts on RFC 6761 reserved domains,
 * all closed in a `finally`.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/e2e-delegate.ts
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R3, J3-R4, J3-R6, J3-R8, J3-R10, J3-R11
 */
import { DELEGATE_SCOPES, CONSENT_METHODS, getActiveDelegation } from '../lib/people/delegation';
import { query, closeAllPools } from '../lib/db/connection';
import { Actor, Results, signUp, signIn, claim, closeAll, undeliverable, BASE } from './walk-harness';

const R = new Results();

function idOf(body: Record<string, unknown>): string {
  return String(
    (body as { id?: string }).id ??
      (body as { recipient?: { id: string } }).recipient?.id ??
      '',
  );
}

interface DelegationView {
  id: string;
  delegate_user_id: string;
  status: string;
  name: string | null;
  email: string | null;
  consent_method?: string | null;
  consent_evidence_ref?: string | null;
  activity: { action: string; ts: string }[];
}

interface DelegationsReply {
  delegations: DelegationView[];
  candidates: { user_id: string; name: string; email: string; person_type: string }[];
  concentrationWarning: unknown;
}

async function delegations(owner: Actor): Promise<DelegationsReply> {
  const res = await owner.call('/api/delegations');
  if (res.status !== 200) throw new Error(`/api/delegations -> HTTP ${res.status}`);
  return res.body as unknown as DelegationsReply;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const parent = new Actor('Parent Owner', undeliverable(`relay-del-parent-${stamp}@relay.test`));
  const child = new Actor('Adult Child', undeliverable(`relay-del-child-${stamp}@relay.test`));
  const outsider = new Actor('Outsider', undeliverable(`relay-del-outsider-${stamp}@relay.test`));

  console.log(
    `base=${BASE}\n  parent=${parent.email}\n  child=${child.email}\n  outsider=${outsider.email}\n`,
  );

  try {
    await signUp(parent);
    await signIn(parent);

    const parentRow = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [parent.email]);
    const parentId = parentRow.rows[0]?.id;
    if (!parentId) throw new Error('the parent account did not land in the cluster');

    // ---- 1. Only a claimed member of the circle is even a candidate --------
    const empty = await delegations(parent);
    R.check(
      'with nobody in the circle, there is nobody to make a helper',
      empty.candidates.length === 0,
      `${empty.candidates.length} candidate(s)`,
    );

    const rec = await parent.post('/api/recipients', {
      name: 'Danny', email: child.email, relationship: 'child', phone: null, role: 'recipient',
    });
    const recipientId = idOf(rec.body);
    R.check('the parent names their child as a recipient', Boolean(recipientId), `HTTP ${rec.status}`);

    const namedOnly = await delegations(parent);
    R.check(
      'being NAMED is not enough — an unclaimed contact is not a candidate',
      namedOnly.candidates.length === 0,
      `${namedOnly.candidates.length} candidate(s) — claiming is the bar, not naming`,
    );

    const inv = await parent.post('/api/invitations', { personId: recipientId, personType: 'recipient' });
    const claimed = await claim(child, String(inv.body.claimCode));
    R.check('the child claims their standby account', claimed.status === 200, `HTTP ${claimed.status}`);

    const afterClaim = await delegations(parent);
    const candidate = afterClaim.candidates.find((c) => c.email === child.email);
    R.check(
      'once claimed, they become a candidate to be a helper',
      Boolean(candidate),
      `${afterClaim.candidates.length} candidate(s)`,
    );
    if (!candidate) throw new Error('no candidate to delegate to');

    // ---- 9. An owner cannot be their own helper ----------------------------
    const self = await parent.post('/api/delegations', { delegateUserId: parentId });
    R.check(
      'self-delegation is refused',
      self.status >= 400,
      `HTTP ${self.status} ${String(self.body.message ?? '')}`,
    );

    // ---- The delegation is created PENDING ---------------------------------
    const madeHelper = await parent.post('/api/delegations', { delegateUserId: candidate.user_id });
    const delegationId = idOf(madeHelper.body);
    R.check('the parent names a helper', madeHelper.status === 201, `HTTP ${madeHelper.status}`);

    const pending = await delegations(parent);
    const dRow = pending.delegations.find((d) => d.id === delegationId);
    R.check(
      'and it lands PENDING, not active',
      dRow?.status === 'pending',
      `status=${dRow?.status}`,
    );
    R.check(
      'the helper is named on the parent’s own screen',
      dRow?.email === child.email,
      `name=${String(dRow?.name)} email=${String(dRow?.email)}`,
    );

    // ---- 2. THE POINT: a pending delegation grants nothing ------------------
    const tooEarly = await child.post('/api/approvals', {
      ownerId: parentId,
      kind: 'recipient',
      payload: {
        name: 'Aunt Jo',
        email: undeliverable(`relay-del-auntjo-${stamp}@relay.test`),
        relationship: 'sibling',
        role: 'recipient',
      },
    });
    R.check(
      '🔴 THE POINT: a helper with no recorded consent can do NOTHING',
      tooEarly.status === 400 || tooEarly.status === 403,
      `HTTP ${tooEarly.status} ${String(tooEarly.body.message ?? '')}`,
    );

    const queueBefore = await parent.call('/api/approvals');
    R.check(
      'and nothing reached the owner’s queue from that attempt',
      ((queueBefore.body as { approvals?: unknown[] }).approvals ?? []).length === 0,
      `${((queueBefore.body as { approvals?: unknown[] }).approvals ?? []).length} pending`,
    );

    // ---- 3. Consent: paper works, nonsense does not ------------------------
    const badMethod = await parent.post(`/api/delegations/${delegationId}/consent`, {
      method: 'telepathy', evidenceRef: null,
    });
    R.check(
      'an unrecognised consent method is refused rather than coerced',
      badMethod.status === 400,
      `HTTP ${badMethod.status} — known: ${CONSENT_METHODS.join(', ')}`,
    );

    const consented = await parent.post(`/api/delegations/${delegationId}/consent`, {
      method: 'paper_upload',
      evidenceRef: 'signed form, blue folder in the hall cupboard',
    });
    R.check(
      'consent on PAPER activates it — no smartphone required (J3-R3)',
      consented.status === 200,
      `HTTP ${consented.status}`,
    );

    // ---- 4. The artifact reads back ----------------------------------------
    const active = await delegations(parent);
    const aRow = active.delegations.find((d) => d.id === delegationId);
    R.check('the delegation is now active', aRow?.status === 'active', `status=${aRow?.status}`);
    R.check(
      '🔴 the consent record READS BACK — the promise on the screen is kept by the product',
      aRow?.consent_method === 'paper_upload' &&
        String(aRow?.consent_evidence_ref ?? '').includes('blue folder'),
      `method=${String(aRow?.consent_method)} ref=${JSON.stringify(aRow?.consent_evidence_ref)}`,
    );

    // ---- 6. Scopes are narrowed at READ time -------------------------------
    const storedScopes = await query<{ scopes: unknown }>(
      `SELECT scopes FROM delegations WHERE id = $1`,
      [delegationId],
    );
    const written = storedScopes.rows[0]?.scopes;
    const writtenList = Array.isArray(written) ? written : JSON.parse(String(written ?? '[]'));
    R.check(
      'the row is created carrying exactly the currently-granted scopes',
      JSON.stringify([...writtenList].sort()) === JSON.stringify([...DELEGATE_SCOPES].sort()),
      JSON.stringify(writtenList),
    );

    /*
      🔴 THE RETIRED-SCOPE GUARD, AGAINST A REAL ROW IN THE REAL CLUSTER — and a
      note about what this assertion is and is not.

      Every delegation made before 2026-08-12 still names `policies:propose` in
      the database and always will; the column is never rewritten.
      `getActiveDelegation` drops it at READ time. Planting it here reproduces
      exactly what production holds for those rows.

      ⚠️ THIS IS DELIBERATELY NOT AN HTTP ASSERTION, and the first draft of this
      walk made it one and got a FALSE GREEN. It posted `kind: 'policy'` and read
      the 400 as the scope being refused — but `/api/approvals` validates `kind`
      after requiring `people:propose`, so the refusal was the kind check and the
      retired scope was never consulted. `policies:propose` has NO consuming
      route (that was the point of removing it), so there is no request that can
      exercise the narrowing end to end. Asserting it through the accessor is the
      honest version: a real row, read by the real function, against the live
      cluster — one layer short of HTTP, and said so rather than implied.
    */
    await query(
      `UPDATE delegations SET scopes = $2 WHERE id = $1`,
      [delegationId, JSON.stringify([...DELEGATE_SCOPES, 'policies:propose'])],
    );
    const planted = await query<{ scopes: unknown }>(
      `SELECT scopes FROM delegations WHERE id = $1`,
      [delegationId],
    );
    const plantedRaw = planted.rows[0]?.scopes;
    const plantedList = Array.isArray(plantedRaw) ? plantedRaw : JSON.parse(String(plantedRaw ?? '[]'));
    R.check(
      'the cluster really holds the retired scope — the plant landed',
      plantedList.includes('policies:propose'),
      JSON.stringify(plantedList),
    );

    const narrowed = await getActiveDelegation(candidate.user_id, parentId);
    R.check(
      '🔴 a row still carrying `policies:propose` does NOT get it back at read time',
      Boolean(narrowed) && !narrowed!.scopes.includes('policies:propose' as never),
      `read back as ${JSON.stringify(narrowed?.scopes)} from a row holding ${JSON.stringify(plantedList)}`,
    );
    await query(
      `UPDATE delegations SET scopes = $2 WHERE id = $1`,
      [delegationId, JSON.stringify(DELEGATE_SCOPES)],
    );

    // ---- 5. The helper proposes, and it QUEUES ------------------------------
    const proposed = await child.post('/api/approvals', {
      ownerId: parentId,
      kind: 'recipient',
      payload: {
        name: 'Aunt Jo',
        email: undeliverable(`relay-del-auntjo2-${stamp}@relay.test`),
        relationship: 'sibling',
        role: 'recipient',
      },
    });
    R.check(
      'an ACTIVE helper can propose',
      proposed.status === 201,
      `HTTP ${proposed.status} ${String(proposed.body.message ?? '')}`,
    );

    const queue = await parent.call('/api/approvals');
    const pendingApprovals = (queue.body as { approvals?: Array<{ id: string; kind: string }> }).approvals ?? [];
    R.check(
      'the proposal QUEUES for the owner — it does not take effect',
      pendingApprovals.length === 1 && pendingApprovals[0].kind === 'recipient',
      `${pendingApprovals.length} pending, kind=${pendingApprovals[0]?.kind}`,
    );

    const beforeApproval = await parent.call('/api/recipients');
    const countBefore = ((beforeApproval.body as { recipients?: unknown[] }).recipients ?? []).length;

    if (!pendingApprovals[0]) throw new Error('nothing queued to approve — the proposal did not land');
    const approvedIt = await parent.post(`/api/approvals/${pendingApprovals[0].id}`, { decision: 'approve' });
    R.check('the owner approves it', approvedIt.status === 200, `HTTP ${approvedIt.status}`);

    const afterApproval = await parent.call('/api/recipients');
    const countAfter = ((afterApproval.body as { recipients?: unknown[] }).recipients ?? []).length;
    R.check(
      'and only THEN does the person exist',
      countAfter === countBefore + 1,
      `${countBefore} -> ${countAfter}`,
    );

    // ---- 7. What the helper did is reviewable -------------------------------
    const reviewed = await delegations(parent);
    const rRow = reviewed.delegations.find((d) => d.id === delegationId);
    R.check(
      'the owner can see what was done on their behalf (J3-R8)',
      (rRow?.activity ?? []).length >= 1,
      `${(rRow?.activity ?? []).length} entr(ies): ${(rRow?.activity ?? []).map((a) => a.action).join(', ')}`,
    );

    // ---- An outsider is not a helper, whatever they claim -------------------
    await signUp(outsider);
    await signIn(outsider);
    const byOutsider = await outsider.post('/api/approvals', {
      ownerId: parentId,
      kind: 'recipient',
      payload: {
        name: 'Nobody',
        email: undeliverable(`relay-del-nobody-${stamp}@relay.test`),
        relationship: 'other',
        role: 'recipient',
      },
    });
    R.check(
      'somebody with no delegation cannot propose against this vault',
      byOutsider.status >= 400,
      `HTTP ${byOutsider.status} ${String(byOutsider.body.message ?? '')}`,
    );

    // ---- 8. Revocation bites immediately ------------------------------------
    const revoked = await parent.del('/api/delegations', { delegationId });
    R.check('the parent withdraws the helper', revoked.status === 200, `HTTP ${revoked.status}`);

    const afterRevoke = await child.post('/api/approvals', {
      ownerId: parentId,
      kind: 'recipient',
      payload: {
        name: 'Too Late',
        email: undeliverable(`relay-del-late-${stamp}@relay.test`),
        relationship: 'other',
        role: 'recipient',
      },
    });
    R.check(
      '🔴 and the helper can no longer act — immediately, not at token expiry',
      afterRevoke.status >= 400,
      `HTTP ${afterRevoke.status} ${String(afterRevoke.body.message ?? '')}`,
    );

    /*
      The withdrawn delegation must leave the LIST as well as the enforcement —
      a revoked helper still rendered as a helper is the screen telling the owner
      something the API has already stopped believing.
    */
    const gone = await delegations(parent);
    R.check(
      'and the withdrawn delegation is gone from the owner’s helper list',
      !gone.delegations.some((d) => d.id === delegationId),
      `${gone.delegations.length} delegation(s) listed`,
    );
  } finally {
    await closeAll([
      { actor: child, kind: 'contact' },
      { actor: outsider, kind: 'owner' },
      { actor: parent, kind: 'owner' },
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
