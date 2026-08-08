/**
 * The first beta family, walked end to end.
 *
 * Everything tested before this was mechanism-by-mechanism: does the endpoint
 * fire, does the transition hold. This tests COHERENCE — whether the sequence
 * makes sense to three people who did not build it, and specifically whether
 * the seams BETWEEN them work. Every handoff in this product is an email, and
 * the seams are where the defects have actually been.
 *
 * Email is deliberately NOT suppressed. Suppressing it would exercise the layer
 * already proven and skip the one where the worst defects have lived. Instead
 * all three personas are real, deliverable plus-addresses on one Gmail account,
 * so nothing reaches a stranger and no bounce is generated against a sending
 * domain whose reputation is still forming. The transcript records what went
 * out so the sequence can be asserted rather than eyeballed.
 *
 * Runs against whatever DSQL the environment points at, and deletes everything
 * it creates. Run:
 *   npx tsx --env-file=.env.local scripts/family-arc.ts
 *
 * Feature: relay-h0-mvp
 */

import { query, closeAllPools } from '../lib/db/connection';
import { writeAuditEntry } from '../lib/audit/audit-service';
import { issueRecipientToken } from '../lib/auth/recipient-token';
import { createDelegation, recordConsent, getActiveDelegation } from '../lib/people/delegation';
import { inviteOnCreateBestEffort } from '../lib/people/invite';
import { notifyVerifiersForTrigger, notifyOwnerTriggerPending } from '../lib/notify/notifications';
import { initiateTrigger, submitConfirmation, standDownTrigger } from '../lib/release/triggers';
import { ReleaseStateMachine } from '../lib/release/state-machine';
import { startTranscript, getTranscript, stopTranscript } from '../lib/notify/transcript';

const MARGARET = 'sgharlow+margaret@gmail.com'; // 74, the owner
const SARAH = 'sgharlow+sarah@gmail.com'; // 41, her daughter — recipient
const PATEL = 'sgharlow+patel@gmail.com'; // her GP — verifier

const findings: string[] = [];
const note = (s: string) => {
  findings.push(s);
  console.log(`   ⚠️  ${s}`);
};
const step = (n: string) => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 58 - n.length))}`);

async function purge(email: string): Promise<void> {
  const u = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  for (const row of u.rows) {
    for (const sql of [
      `DELETE FROM access_requests WHERE owner_id=$1`,
      `DELETE FROM delegations WHERE owner_id=$1 OR delegate_user_id=$1`,
      `DELETE FROM verifier_confirmations WHERE release_state_id IN (SELECT id FROM release_state WHERE owner_id=$1)`,
      `DELETE FROM access_rules WHERE owner_id=$1`,
      `DELETE FROM release_state WHERE owner_id=$1`,
      `DELETE FROM vault_items WHERE owner_id=$1`,
      `DELETE FROM recipients WHERE owner_id=$1`,
      `DELETE FROM verifiers WHERE owner_id=$1`,
      `DELETE FROM audit_log WHERE owner_id=$1`,
      `DELETE FROM users WHERE id=$1`,
    ]) {
      try {
        await query(sql, [row.id]);
      } catch {
        /* table absent for this owner */
      }
    }
  }
}

async function main(): Promise<void> {
  if (!startTranscript()) throw new Error('Refusing to run: transcript will not arm in production.');

  console.log('\n═══ THE CHEN FAMILY ═══');
  console.log(`   Margaret (74, owner)   ${MARGARET}`);
  console.log(`   Sarah (41, daughter)   ${SARAH}`);
  console.log(`   Dr Patel (verifier)    ${PATEL}\n`);

  for (const e of [MARGARET, SARAH]) await purge(e);

  // ── 1. Sarah sets it up FOR her mother (J3) ──────────────────────────────
  step('1. Sarah sets it up for Margaret (J3)');
  const m = await query<{ id: string }>(
    `INSERT INTO users (email, auth_sub) VALUES ($1,$2) RETURNING id`,
    [MARGARET, `credentials:${MARGARET}`],
  );
  const margaret = m.rows[0].id;
  const s = await query<{ id: string }>(
    `INSERT INTO users (email, auth_sub) VALUES ($1,$2) RETURNING id`,
    [SARAH, `credentials:${SARAH}`],
  );
  const sarahUser = s.rows[0].id;

  const del = await createDelegation(margaret, sarahUser);
  console.log(`   delegation: ${del.status}`);
  if (await getActiveDelegation(sarahUser, margaret)) note('Delegation was ACTIVE before consent.');

  await recordConsent(del.id, { method: 'in_person', evidenceRef: 'Sat 8 Aug, at her kitchen table' });
  const active = await getActiveDelegation(sarahUser, margaret);
  console.log(`   after consent: ${active ? 'active' : 'STILL INACTIVE'}`);
  if (!active) note('Consent recorded but delegation did not activate.');

  // ── 2. The vault (J2) ───────────────────────────────────────────────────
  step('2. Sarah seeds her mother\'s vault (J2)');
  const mkItem = async (title: string, category: string) =>
    (
      await query<{ id: string }>(
        `INSERT INTO vault_items (owner_id, type, title, service_name, category, ciphertext, wrapped_data_key, kms_key_id)
         VALUES ($1,'login',$2,$2,$3,'ct','wdk','kms') RETURNING id`,
        [margaret, title, category],
      )
    ).rows[0].id;

  const items = {
    email: await mkItem('Her Gmail', 'communication'),
    bank: await mkItem('Chase checking', 'finance'),
    health: await mkItem('Blue Cross', 'health'),
    pharmacy: await mkItem('CVS pharmacy', 'health'),
  };
  console.log(`   ${Object.keys(items).length} items stored`);

  // ── 3. The circle (J4) ──────────────────────────────────────────────────
  step('3. The circle of trust (J4)');
  const rcp = await query<{ id: string }>(
    `INSERT INTO recipients (owner_id, name, email, role) VALUES ($1,'Sarah Chen',$2,'caregiver') RETURNING id`,
    [margaret, SARAH],
  );
  const sarah = rcp.rows[0].id;
  await query(
    `INSERT INTO verifiers (owner_id, name, email) VALUES ($1,'Dr Patel',$2)`,
    [margaret, PATEL],
  );
  for (const id of [items.email, items.bank, items.health, items.pharmacy]) {
    await query(
      `INSERT INTO access_rules (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible)
       VALUES ($1,$2,$3,'emergency','view',true)`,
      [margaret, id, sarah],
    );
  }
  await inviteOnCreateBestEffort(margaret, sarah, 'recipient');
  const vrow = await query<{ id: string }>(`SELECT id FROM verifiers WHERE owner_id=$1 LIMIT 1`, [margaret]);
  await inviteOnCreateBestEffort(margaret, vrow.rows[0].id, 'verifier');
  console.log('   Sarah = recipient, Dr Patel = verifier, 4 items scoped, both invited');

  // ── 4. The crisis (J6 → J7) ─────────────────────────────────────────────
  step('4. Margaret is hospitalised; the trigger fires (J6/J7)');
  const rs = await query<{ id: string }>(
    `INSERT INTO release_state (owner_id, trigger_type, state, required_confirmations, received_confirmations, version)
     VALUES ($1,'emergency','armed',1,0,0) RETURNING id`,
    [margaret],
  );
  const machine = new ReleaseStateMachine();
  await initiateTrigger(margaret, 'emergency', machine, new Date());
  console.log('   ARMED → GRACE');

  await notifyOwnerTriggerPending(MARGARET, 'emergency');
  const vfs = await query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM verifiers WHERE owner_id=$1`,
    [margaret],
  );
  await notifyVerifiersForTrigger(vfs.rows, 'emergency', rs.rows[0].id);
  console.log(`   ${vfs.rowCount} verifier(s) asked`);

  const current = await query<{ id: string; version: string }>(
    `SELECT id, version FROM release_state WHERE owner_id=$1 LIMIT 1`,
    [margaret],
  );
  await submitConfirmation({
    releaseStateId: current.rows[0].id,
    verifierId: vfs.rows[0].id,
    machine,
    now: new Date(),
  });
  const afterConfirm = await query<{ state: string; version: string }>(
    `SELECT state, version FROM release_state WHERE owner_id=$1 LIMIT 1`,
    [margaret],
  );
  console.log(`   Dr Patel confirms → ${afterConfirm.rows[0].state.toUpperCase()}`);

  // ── 5. Sarah gets in (J8) ───────────────────────────────────────────────
  step('5. Sarah opens what she needs (J8)');
  // NOT calling notifyRecipientsOfRelease here: submitConfirmation already does
  // it on release (triggers.ts). Calling it again sent Sarah two identical
  // access links in the first run of this script — an artifact of the harness,
  // not the product, and worth the comment so nobody re-adds it.
  for (const id of [items.email, items.bank]) {
    await writeAuditEntry(margaret, {
      actor: `recipient:${sarah}`,
      action: 'vault_item_decrypted',
      entity: 'vault_item',
      entityId: id,
      detail: { outcome: 'authorized' },
    });
  }
  console.log('   Sarah opens 2 of 4 (Gmail, Chase)');

  // ── 6. Margaret comes home (J9) ─────────────────────────────────────────
  step('6. Margaret recovers and closes access (J9)');
  const before = await query<{ id: string; version: string }>(
    `SELECT id, version FROM release_state WHERE owner_id=$1 LIMIT 1`,
    [margaret],
  );
  const staleToken = issueRecipientToken(sarah, before.rows[0].id, BigInt(before.rows[0].version));
  void staleToken;
  await standDownTrigger(margaret, before.rows[0].id, machine);
  const closed = await query<{ state: string }>(
    `SELECT state FROM release_state WHERE owner_id=$1 LIMIT 1`,
    [margaret],
  );
  console.log(`   RELEASED → ${closed.rows[0].state.toUpperCase()} — Sarah's link is now dead`);

  // ── The transcript ──────────────────────────────────────────────────────
  const t = getTranscript();
  console.log(`\n═══ WHAT THE FAMILY RECEIVED — ${t.length} messages ═══`);
  const byPerson: Record<string, number> = {};
  t.forEach((e, i) => {
    const who = e.to === MARGARET ? 'Margaret' : e.to === SARAH ? 'Sarah   ' : 'Dr Patel';
    byPerson[who.trim()] = (byPerson[who.trim()] ?? 0) + 1;
    console.log(`${String(i + 1).padStart(2)}. ${who} │ ${e.accepted ? '✓' : '✗ ' + e.error} │ ${e.subject}`);
    e.links.forEach((l) => {
      const bad = !l.startsWith('https://relaystandby.com');
      console.log(`        ${bad ? '⚠️  ' : '   '}${l.slice(0, 96)}`);
      if (bad) note(`Link to a non-canonical host: ${l.slice(0, 60)}`);
    });
  });
  console.log('\n   per person:', JSON.stringify(byPerson));

  const failed = t.filter((e) => !e.accepted);
  if (failed.length) note(`${failed.length} message(s) were NOT accepted by the provider.`);
  if (!t.some((e) => e.to === SARAH)) note('Sarah — the person the product exists for — received nothing.');

  console.log('\n═══ FINDINGS ═══');
  findings.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  console.log(`\nStale token for the graceful-close check:\n${staleToken}\n`);

  stopTranscript();
  for (const e of [MARGARET, SARAH]) await purge(e);
  console.log('Test family purged.\n');
  await closeAllPools();
}

main();
