/**
 * J9 — standing down. The differentiator, and the journey with no automated cover.
 *
 * WHY THIS EXISTS. J9 is the reason Relay is not a dead-man's switch: a release
 * that opens can be closed, and an owner who comes home finds a control rather
 * than a permanent handoff. It had no automated cover at all — its most recent
 * evidence was the hand sweep of 2026-08-13 — and the sprint of 2026-08-21
 * changed code on this exact path twice:
 *
 *   1. `standDownTrigger`'s bookkeeping reset was CONDITIONAL on
 *      `row.state === 'released'`. Standing down from PENDING or GRACE — the
 *      ordinary false alarm caught early, which is what the control was built
 *      for — cleared nothing. A 2-of-3 with one verifier already confirmed went
 *      back to ARMED still carrying that vote, so the NEXT emergency opened the
 *      vault on one live confirmation plus a stale one. The comment described
 *      the intent, the condition described the rarer path, and nothing described
 *      what ran. Unit tests passed throughout.
 *   2. `POST /api/triggers/[id]/stand-down` called `requireOwner()` with no
 *      `req`, so no liveness was stamped. An owner stood a false alarm down, the
 *      hourly sweep still read them as overdue, re-armed the same trigger, and
 *      asked every verifier again — hourly, until they happened to press the
 *      other button. J5's preamble names that as the failure that destroys the
 *      product.
 *
 * THE DISCRIMINATING ASSERTION IS THE STALE VOTE. It needs a 2-of-2 quorum, one
 * verifier who answers, and a stand-down taken while the tally sits at 1/2 —
 * a shape no unit test reproduced and the only one that catches (1) coming back.
 *
 * ⚠️ `/api/triggers/[id]/cancel` WAS RETIRED on 2026-08-21 and this walk asserts
 * it is gone. Stand down is now the only stop control, which raises the stakes
 * on everything above rather than lowering them.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * production cluster. Four disposable accounts on RFC 6761 reserved domains,
 * all closed in a `finally`.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/e2e-standdown.ts
 *
 * Feature: relay-h0-mvp
 * Requirements: J9-R1, J9-R2, J9-R3, J5-R1, 5.3, 4.5, 4.2
 */
import { encodeSecretPayload } from '../lib/crypto/secret-payload';
import { CryptoService } from '../lib/crypto/crypto-service';
import { issueVerifierToken } from '../lib/auth/verifier-token';
import { query, closeAllPools } from '../lib/db/connection';
import { Actor, Results, signUp, signIn, claim, closeAll, undeliverable, BASE } from './walk-harness';

const R = new Results();

const SECRET = {
  username: 'held.account@example.test',
  password: 'stand-down-and-re-arm-5591',
};

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
  received_confirmations: number;
  received_denials: number | null;
  released_at: string | null;
  grace_ends_at: string | null;
  version: number;
}

async function releaseRow(ownerEmail: string): Promise<ReleaseRow | undefined> {
  const res = await query<ReleaseRow>(
    `SELECT rs.id, rs.state, rs.received_confirmations, rs.received_denials,
            rs.released_at, rs.grace_ends_at, rs.version
       FROM release_state rs JOIN users u ON u.id = rs.owner_id
      WHERE u.email = $1 AND rs.trigger_type = 'emergency'
      ORDER BY rs.created_at DESC LIMIT 1`,
    [ownerEmail],
  );
  return res.rows[0];
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
  const owner = new Actor('Standdown Owner', undeliverable(`relay-sd-owner-${stamp}@relay.test`));
  const contact = new Actor('Standdown Contact', undeliverable(`relay-sd-contact-${stamp}@relay.test`));
  const v1 = new Actor('Verifier One', undeliverable(`relay-sd-v1-${stamp}@relay.test`));
  const v2 = new Actor('Verifier Two', undeliverable(`relay-sd-v2-${stamp}@relay.test`));

  console.log(
    `base=${BASE}\n  owner=${owner.email}\n  contact=${contact.email}\n` +
      `  verifier1=${v1.email}\n  verifier2=${v2.email}\n`,
  );

  try {
    // ---- A vault with something in it, and a circle around it --------------
    await signUp(owner);
    await signIn(owner);

    const svc = new CryptoService(owner.fetchAs());
    const payload = await svc.encryptForUpload(
      encodeSecretPayload([
        { kind: 'username', value: SECRET.username },
        { kind: 'password', value: SECRET.password },
      ]),
      {
        type: 'login',
        title: 'The account that gets opened and closed',
        service_name: 'Example',
        category: 'finance',
        criticality: 'critical',
      } as never,
    );
    const created = await owner.post('/api/vault/items', payload);
    const itemId = idOf(created.body);
    R.check('the owner stores a real, encrypted item', Boolean(itemId), `HTTP ${created.status}`);

    const rec = await owner.post('/api/recipients', {
      name: 'Sarah', email: contact.email, relationship: 'child', phone: null, role: 'recipient',
    });
    const recipientId = idOf(rec.body);

    await owner.post('/api/rules', {
      recipient_id: recipientId,
      vault_item_id: itemId,
      trigger_type: 'emergency',
      scope: 'view',
      reversible: true,
    });

    const verifierIds: string[] = [];
    for (const [i, actor] of [v1, v2].entries()) {
      const ver = await owner.post('/api/verifiers', {
        name: `Verifier ${i + 1}`, email: actor.email, phone: null, relationship: 'physician',
      });
      const vid = idOf(ver.body);
      verifierIds.push(vid);
      const vinv = await owner.post('/api/invitations', { personId: vid, personType: 'verifier' });
      await claim(actor, String(vinv.body.claimCode));
      // An UNCONFIRMED verifier's answer is recorded and does not count (§4.3),
      // so confirming is not optional set-up — it is the rule being satisfied.
      await owner.post(`/api/people/${vid}/confirm`, { personType: 'verifier' });
    }
    R.check('two confirmed verifiers exist', verifierIds.length === 2 && verifierIds.every(Boolean), verifierIds.join(' '));

    const inv = await owner.post('/api/invitations', { personId: recipientId, personType: 'recipient' });
    const claimed = await claim(contact, String(inv.body.claimCode));
    R.check('the recipient claims a standby account in calm', claimed.status === 200, `HTTP ${claimed.status}`);

    // ================= PART 1: the stale vote =================================
    /*
      A 2-of-2 quorum. One verifier answers, the tally sits at 1/2, and the owner
      stands the false alarm down from GRACE. Before 2026-08-21 that vote SURVIVED
      the re-arm, and the next emergency opened on one live answer plus a stale one.
    */
    const cfg = await owner.put(`/api/triggers/emergency/config`, { required_confirmations: 2 });
    R.check('the owner sets a 2-of-2 quorum', cfg.status === 200, `HTTP ${cfg.status} ${JSON.stringify(cfg.body)}`);

    const fired = await owner.post('/api/triggers/emergency/initiate', {});
    R.check('the owner fires an emergency', fired.status === 200, `HTTP ${fired.status}`);

    let row = await releaseRow(owner.email);
    if (!row) throw new Error('no release_state row after initiate');
    R.check(
      'an emergency lands in GRACE — its window is zero, so the sweep is not needed',
      row.state === 'grace',
      `state=${row.state}`,
    );

    const token1 = await issueVerifierToken(verifierIds[0], row.id);
    const answered = await contact.post(`/api/triggers/${row.id}/confirm`, {
      verifier_token: token1, method: 'email', decision: 'confirm',
    });
    const outcome = answered.body as { status?: string; received?: number; required?: number };
    R.check(
      'ONE verifier answers and the tally advances but does not release',
      answered.status === 200 && outcome.status !== 'not_counted' && (outcome.received ?? 0) === 1,
      `HTTP ${answered.status} ${outcome.status ?? ''} ${outcome.received ?? '?'}/${outcome.required ?? '?'}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'the release is still open at 1 of 2 — nothing has been granted',
      row?.state === 'grace' && Number(row?.received_confirmations) === 1,
      `state=${row?.state} confirmations=${row?.received_confirmations}`,
    );

    const beforeStandDown = await lastActiveAt(owner.email);

    const stoodDown = await owner.post(`/api/triggers/${row!.id}/stand-down`, {});
    R.check(
      'the owner stands the false alarm down from GRACE',
      stoodDown.status === 200 && (stoodDown.body as { state?: string }).state === 'armed',
      `HTTP ${stoodDown.status} state=${String((stoodDown.body as { state?: string }).state)}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      '🔴 THE POINT: the vote does NOT survive the re-arm',
      Number(row?.received_confirmations) === 0,
      `received_confirmations=${row?.received_confirmations} — 1 here means the next emergency starts pre-confirmed`,
    );
    R.check(
      'and the denial count and the grace clock are cleared with it',
      Number(row?.received_denials ?? 0) === 0 && row?.grace_ends_at === null,
      `denials=${row?.received_denials} grace_ends_at=${String(row?.grace_ends_at)}`,
    );

    const afterStandDown = await lastActiveAt(owner.email);
    R.check(
      '🔴 THE 2026-08-21 FIX, LIVE: standing down counts as being alive',
      Boolean(afterStandDown) &&
        (!beforeStandDown || Date.parse(afterStandDown as string) > Date.parse(beforeStandDown)),
      `last_active_at ${beforeStandDown ?? 'null'} -> ${afterStandDown ?? 'null'} ` +
        `(unchanged means the sweep re-arms this hourly and asks every verifier again)`,
    );

    // ================= PART 2: closing a REAL release =========================
    /*
      Now the whole way: 1-of-2 so a single answer releases, the recipient really
      reveals the plaintext, and the owner closes it. This is the half the
      2026-08-13 hand sweep covered and nothing automated ever did.
    */
    const cfg1 = await owner.put(`/api/triggers/emergency/config`, { required_confirmations: 1 });
    R.check('the owner lowers the quorum to 1', cfg1.status === 200, `HTTP ${cfg1.status}`);

    const refired = await owner.post('/api/triggers/emergency/initiate', {});
    R.check('a second emergency is fired', refired.status === 200, `HTTP ${refired.status}`);

    row = await releaseRow(owner.email);
    if (!row) throw new Error('no release_state row after the second initiate');

    const token2 = await issueVerifierToken(verifierIds[1], row.id);
    const confirmed2 = await contact.post(`/api/triggers/${row.id}/confirm`, {
      verifier_token: token2, method: 'email', decision: 'confirm',
    });
    R.check('the second verifier confirms', confirmed2.status === 200, `HTTP ${confirmed2.status}`);

    row = await releaseRow(owner.email);
    R.check('the release reaches RELEASED', row?.state === 'released', `state=${row?.state}`);

    const revealed = await contact.post(`/api/access/${itemId}/decrypt`, {});
    R.check(
      'the recipient really can open it — access is granted, not merely recorded',
      revealed.status === 200,
      `HTTP ${revealed.status} ${String(revealed.body.error ?? '')}`,
    );

    // ---- The close ----------------------------------------------------------
    const closed = await owner.post(`/api/triggers/${row!.id}/stand-down`, {});
    R.check(
      'the owner closes a RELEASED trigger — home from hospital, and there is a button',
      closed.status === 200 && (closed.body as { state?: string }).state === 'armed',
      `HTTP ${closed.status} state=${String((closed.body as { state?: string }).state)}`,
    );

    row = await releaseRow(owner.email);
    R.check(
      'released_at is cleared, so the next emergency does not start already-released',
      row?.released_at === null && Number(row?.received_confirmations) === 0,
      `released_at=${String(row?.released_at)} confirmations=${row?.received_confirmations}`,
    );

    /*
      🔴 THE ASSERTION THAT MAKES CLOSING MEAN ANYTHING. A state column set back
      to `armed` while the recipient's session still decrypts is not a close — it
      is a label. The same actor who succeeded four lines ago must now fail.
    */
    const afterClose = await contact.post(`/api/access/${itemId}/decrypt`, {});
    R.check(
      '🔴 THE POINT: the recipient who could read it a moment ago now cannot',
      afterClose.status !== 200,
      `HTTP ${afterClose.status} ${String(afterClose.body.error ?? '')}`,
    );

    // ---- The retired control ------------------------------------------------
    const cancel = await owner.post(`/api/triggers/${row!.id}/cancel`, {});
    R.check(
      '/cancel is gone — stand down is the only stop control (retired 2026-08-21)',
      cancel.status === 404 || cancel.status === 405,
      `HTTP ${cancel.status}`,
    );

    // ---- Re-arm is a real re-arm --------------------------------------------
    const thirdFire = await owner.post('/api/triggers/emergency/initiate', {});
    R.check(
      'and the trigger genuinely re-armed — it can fire again',
      thirdFire.status === 200,
      `HTTP ${thirdFire.status}`,
    );
    row = await releaseRow(owner.email);
    R.check(
      'the third emergency starts from a clean tally, not a carried one',
      Number(row?.received_confirmations) === 0,
      `state=${row?.state} confirmations=${row?.received_confirmations}`,
    );
    await owner.post(`/api/triggers/${row!.id}/stand-down`, {});
  } finally {
    await closeAll([
      { actor: contact, kind: 'contact' },
      { actor: v1, kind: 'contact' },
      { actor: v2, kind: 'contact' },
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
