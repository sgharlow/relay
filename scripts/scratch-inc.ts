/** Scratch: a real incident, for the §8.2 record. Not committed. */
import { randomUUID } from 'crypto';
import { query, closeAllPools } from '../lib/db/connection';
import { deleteAccount } from '../lib/account/lifecycle';
import { upsertUser } from '../lib/auth/upsert-user';
import { createInvitation, formatInviteCode } from '../lib/people/invitations';
import { writeAuditEntry } from '../lib/audit/audit-service';

const P = 'inc-parent-qa@relaystandby.com';
const A = 'inc-a-qa@relaystandby.com';
async function idFor(e: string) {
  const r = await query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [e]);
  return r.rows[0]?.id;
}
async function main() {
  const cmd = process.argv[2];
  if (cmd === 'bootstrap') {
    const { id: p } = await upsertUser(`qa|${randomUUID()}`, P);
    const row = randomUUID();
    await query(`INSERT INTO recipients (id, owner_id, name, email, role) VALUES ($1,$2,'Inc A',$3,'caregiver')`, [row, p, A]);
    const { token } = await createInvitation(p, { personId: row, personType: 'recipient', deliveryChannel: 'owner', cohort: 'inc' });
    console.log(JSON.stringify({ claim: formatInviteCode(token), raw: token }));
  } else if (cmd === 'incident') {
    const o = process.argv[3];
    const item = randomUUID();
    await query(`INSERT INTO vault_items (id, owner_id, title, type, category, ciphertext, wrapped_data_key, kms_key_id, importance_score, criticality)
      VALUES ($1,$2,'Chase Bank','account','finance',$3,$4,'k',0.9,'critical')`, [item, o, Buffer.from('c'), Buffer.from('w')]);
    const item2 = randomUUID();
    await query(`INSERT INTO vault_items (id, owner_id, title, type, category, ciphertext, wrapped_data_key, kms_key_id, importance_score, criticality)
      VALUES ($1,$2,'Gmail','login','communication',$3,$4,'k',0.98,'critical')`, [item2, o, Buffer.from('c'), Buffer.from('w')]);
    const rec = randomUUID();
    await query(`INSERT INTO recipients (id, owner_id, name, email, role, standby_state) VALUES ($1,$2,'Jordan Rivera','inc-jordan-qa@relaystandby.com','partner','confirmed')`, [rec, o]);
    const ver = randomUUID();
    await query(`INSERT INTO verifiers (id, owner_id, name, email, standby_state) VALUES ($1,$2,'Dr. Alex Chen','inc-doc-qa@relaystandby.com','confirmed')`, [ver, o]);
    const rs = randomUUID();
    await query(`INSERT INTO release_state (id, owner_id, trigger_type, state, version, required_confirmations, received_confirmations)
      VALUES ($1,$2,'emergency','armed',1,1,0)`, [rs, o]);

    // A complete episode, written the way the product writes it.
    await writeAuditEntry(o, { actor: `recipient:${rec}`, action: 'trigger_initiated', entity: 'release_state', entityId: rs, detail: { trigger_type: 'emergency' } });
    await writeAuditEntry(o, { actor: `verifier:${ver}`, action: 'verifier_confirmed', entity: 'release_state', entityId: rs, detail: { received: 1, required: 1 } });
    await writeAuditEntry(o, { actor: `recipient:${rec}`, action: 'vault_item_decrypted', entity: 'vault_item', entityId: item, detail: { outcome: 'authorized' } });
    await writeAuditEntry(o, { actor: `recipient:${rec}`, action: 'vault_item_decrypted', entity: 'vault_item', entityId: item2, detail: { outcome: 'authorized' } });
    await writeAuditEntry(o, { actor: `recipient:${rec}`, action: 'vault_item_decrypted', entity: 'vault_item', entityId: item, detail: { outcome: 'authorized' } });
    await writeAuditEntry(o, { actor: 'system', action: 'release_transition_armed', entity: 'release_state', entityId: rs, detail: { from: 'released', to: 'armed' } });
    console.log('incident written');
  } else if (cmd === 'teardown') {
    for (const e of [A, P]) { const id = await idFor(e); if (id) await deleteAccount(id); }
    for (const t of ['recipients','verifiers','vault_items','release_state','invitations']) {
      await query(`DELETE FROM ${t} WHERE owner_id NOT IN (SELECT id FROM users)`);
    }
    const left = await query<{n:string}>(`SELECT count(*)::text AS n FROM users WHERE email LIKE '%qa@relaystandby.com'`);
    console.log(`qa users remaining=${left.rows[0]?.n}`);
  }
  await closeAllPools();
}
main().catch((e)=>{console.error(e);process.exit(1);});
