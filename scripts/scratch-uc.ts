/** Scratch: use-case walkthrough fixture. Not committed. */
import { randomUUID } from 'crypto';
import { query, closeAllPools } from '../lib/db/connection';
import { deleteAccount } from '../lib/account/lifecycle';
import { upsertUser } from '../lib/auth/upsert-user';
import { createInvitation, formatInviteCode } from '../lib/people/invitations';
import { issueBreakGlass, formatBreakGlass } from '../lib/people/break-glass';
import { writeAuditEntry } from '../lib/audit/audit-service';

const P = 'uc-parent-qa@relaystandby.com';
const O = 'uc-owner-qa@relaystandby.com';
async function idFor(e: string) {
  const r = await query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [e]);
  return r.rows[0]?.id;
}
async function main() {
  const cmd = process.argv[2];
  if (cmd === 'bootstrap') {
    const { id: p } = await upsertUser(`qa|${randomUUID()}`, P);
    const row = randomUUID();
    await query(`INSERT INTO recipients (id, owner_id, name, email, role) VALUES ($1,$2,'UC Owner',$3,'caregiver')`, [row, p, O]);
    const { token } = await createInvitation(p, { personId: row, personType: 'recipient', deliveryChannel: 'owner', cohort: 'uc' });
    console.log(JSON.stringify({ claim: formatInviteCode(token), raw: token }));
  } else if (cmd === 'plan') {
    const o = process.argv[3];
    const mk = async (e: string) => (await upsertUser(`standby:${e}`, e)).id;
    const gmail = randomUUID(), chase = randomUUID();
    await query(`INSERT INTO vault_items (id, owner_id, title, type, category, ciphertext, wrapped_data_key, kms_key_id, importance_score, criticality, is_root_credential)
      VALUES ($1,$2,'Gmail','login','communication',$3,$4,'k',0.98,'critical',true)`, [gmail, o, Buffer.from('c'), Buffer.from('w')]);
    await query(`INSERT INTO vault_items (id, owner_id, title, type, category, ciphertext, wrapped_data_key, kms_key_id, importance_score, criticality)
      VALUES ($1,$2,'Chase Bank','account','finance',$3,$4,'k',0.9,'critical')`, [chase, o, Buffer.from('c'), Buffer.from('w')]);

    const spouse = randomUUID(), uSpouse = await mk('uc-spouse-qa@relaystandby.com');
    await query(`INSERT INTO recipients (id, owner_id, name, relationship, email, role, claimed_user_id, standby_state, fingerprint_confirmed_at)
      VALUES ($1,$2,'Jordan Rivera','Spouse','uc-spouse-qa@relaystandby.com','partner',$3,'confirmed',now())`, [spouse, o, uSpouse]);
    await query(`INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter) VALUES ($1,$2,'pub',0)`, [uSpouse, 'uc-' + randomUUID()]);
    const aunt = randomUUID();
    await query(`INSERT INTO recipients (id, owner_id, name, relationship, email, role, break_glass_only)
      VALUES ($1,$2,'Aunt Margaret','Aunt','uc-margaret-qa@relaystandby.com','recipient',true)`, [aunt, o]);
    for (const it of [gmail, chase]) {
      await query(`INSERT INTO access_rules (id, owner_id, recipient_id, vault_item_id, trigger_type, scope, reversible)
        VALUES ($1,$2,$3,$4,'emergency','view',true)`, [randomUUID(), o, spouse, it]);
    }
    const doc = randomUUID(), uDoc = await mk('uc-doc-qa@relaystandby.com');
    await query(`INSERT INTO verifiers (id, owner_id, name, email, claimed_user_id, standby_state, fingerprint_confirmed_at)
      VALUES ($1,$2,'Dr. Alex Chen','uc-doc-qa@relaystandby.com',$3,'confirmed',now())`, [doc, o, uDoc]);
    await issueBreakGlass({ ownerId: o, personId: doc, personType: 'verifier' });
    const pat = randomUUID();
    await query(`INSERT INTO verifiers (id, owner_id, name, email) VALUES ($1,$2,'Pat Morgan','uc-pat-qa@relaystandby.com')`, [pat, o]);
    const { token: patTok } = await createInvitation(o, { personId: pat, personType: 'verifier', deliveryChannel: 'owner', cohort: 'uc' });

    const rs = randomUUID();
    await query(`INSERT INTO release_state (id, owner_id, trigger_type, state, version, required_confirmations, received_confirmations)
      VALUES ($1,$2,'emergency','armed',1,1,0)`, [rs, o]);

    // A closed episode, so the audit record has something true to show.
    await writeAuditEntry(o, { actor: `recipient:${spouse}`, action: 'trigger_initiated', entity: 'release_state', entityId: rs, detail: { trigger_type: 'emergency' } });
    await writeAuditEntry(o, { actor: `verifier:${doc}`, action: 'verifier_confirmed', entity: 'release_state', entityId: rs, detail: {} });
    await writeAuditEntry(o, { actor: `recipient:${spouse}`, action: 'vault_item_decrypted', entity: 'vault_item', entityId: gmail, detail: { outcome: 'authorized' } });
    await writeAuditEntry(o, { actor: 'system', action: 'release_transition_armed', entity: 'release_state', entityId: rs, detail: { from: 'released', to: 'armed' } });
    console.log(JSON.stringify({ patInvite: formatInviteCode(patTok), patRaw: patTok }));
  } else if (cmd === 'teardown') {
    for (const e of [O, P, 'uc-spouse-qa@relaystandby.com','uc-doc-qa@relaystandby.com','uc-pat-qa@relaystandby.com']) {
      const id = await idFor(e); if (id) await deleteAccount(id);
    }
    for (const t of ['recipients','verifiers','vault_items','access_rules','release_state','invitations','break_glass_codes']) {
      await query(`DELETE FROM ${t} WHERE owner_id NOT IN (SELECT id FROM users)`);
    }
    await query(`DELETE FROM webauthn_credentials WHERE user_id NOT IN (SELECT id FROM users)`);
    const left = await query<{n:string}>(`SELECT count(*)::text AS n FROM users WHERE email LIKE '%qa@relaystandby.com'`);
    console.log(`qa users remaining=${left.rows[0]?.n}`);
  }
  await closeAllPools();
}
main().catch((e)=>{console.error(e);process.exit(1);});
