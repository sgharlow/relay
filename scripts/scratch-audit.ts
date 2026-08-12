/** Scratch: realistic beta-shaped fixture for the UI audit. Not committed. */
import { randomUUID } from 'crypto';
import { query, closeAllPools } from '../lib/db/connection';
import { deleteAccount } from '../lib/account/lifecycle';
import { upsertUser } from '../lib/auth/upsert-user';
import { createInvitation, formatInviteCode } from '../lib/people/invitations';
import { issueBreakGlass } from '../lib/people/break-glass';

const P = 'aud-parent-qa@relaystandby.com';
const OWNER = 'aud-owner-qa@relaystandby.com';

async function idFor(e: string) {
  const r = await query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [e]);
  return r.rows[0]?.id;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'bootstrap') {
    const { id: p } = await upsertUser(`qa|${randomUUID()}`, P);
    const row = randomUUID();
    await query(`INSERT INTO recipients (id, owner_id, name, email, role) VALUES ($1,$2,'Audit Owner',$3,'caregiver')`, [row, p, OWNER]);
    const { token } = await createInvitation(p, { personId: row, personType: 'recipient', deliveryChannel: 'owner', cohort: 'aud' });
    console.log(JSON.stringify({ claim: formatInviteCode(token), raw: token }));
  } else if (cmd === 'plan') {
    const o = process.argv[3];
    const mkUser = async (email: string) => (await upsertUser(`standby:${email}`, email)).id;

    // A vault with a critical item.
    const item = randomUUID();
    await query(`INSERT INTO vault_items (id, owner_id, title, type, category, ciphertext, wrapped_data_key, kms_key_id, importance_score, criticality, is_root_credential)
      VALUES ($1,$2,'Gmail','login','communication',$3,$4,'k',0.98,'critical',true)`, [item, o, Buffer.from('c'), Buffer.from('w')]);

    // Recipients: one confirmed w/ passkey, one claimed-unverified, one paper-only.
    const rConf = randomUUID(); const uConf = await mkUser('aud-spouse-qa@relaystandby.com');
    await query(`INSERT INTO recipients (id, owner_id, name, relationship, email, role, claimed_user_id, standby_state, fingerprint_confirmed_at)
      VALUES ($1,$2,'Jordan Rivera','Spouse','aud-spouse-qa@relaystandby.com','partner',$3,'confirmed',now())`, [rConf, o, uConf]);
    await query(`INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter) VALUES ($1,$2,'pub',0)`, [uConf, 'aud-' + randomUUID()]);

    const rClaim = randomUUID(); const uClaim = await mkUser('aud-kid-qa@relaystandby.com');
    await query(`INSERT INTO recipients (id, owner_id, name, relationship, email, role, claimed_user_id, standby_state)
      VALUES ($1,$2,'Sam Rivera','Son','aud-kid-qa@relaystandby.com','recipient',$3,'claimed')`, [rClaim, o, uClaim]);

    const rPaper = randomUUID();
    await query(`INSERT INTO recipients (id, owner_id, name, relationship, email, role, break_glass_only)
      VALUES ($1,$2,'Aunt Margaret','Aunt','aud-margaret-qa@relaystandby.com','recipient',true)`, [rPaper, o]);

    await query(`INSERT INTO access_rules (id, owner_id, recipient_id, vault_item_id, trigger_type, scope, reversible)
      VALUES ($1,$2,$3,$4,'emergency','view',true)`, [randomUUID(), o, rConf, item]);

    // Verifiers: one confirmed no-passkey-no-code (the warning case), one invited.
    const vConf = randomUUID(); const uV = await mkUser('aud-doc-qa@relaystandby.com');
    await query(`INSERT INTO verifiers (id, owner_id, name, email, claimed_user_id, standby_state, fingerprint_confirmed_at)
      VALUES ($1,$2,'Dr. Alex Chen','aud-doc-qa@relaystandby.com',$3,'confirmed',now())`, [vConf, o, uV]);
    const vNew = randomUUID();
    await query(`INSERT INTO verifiers (id, owner_id, name, email) VALUES ($1,$2,'Pat Morgan','aud-pat-qa@relaystandby.com')`, [vNew, o]);
    await issueBreakGlass({ ownerId: o, personId: vNew, personType: 'verifier' });

    await query(`INSERT INTO release_state (id, owner_id, trigger_type, state, version, required_confirmations, received_confirmations)
      VALUES ($1,$2,'emergency','armed',1,1,0)`, [randomUUID(), o]);
    console.log('seeded a realistic mid-setup circle');
  } else if (cmd === 'teardown') {
    for (const e of [OWNER, P, 'aud-spouse-qa@relaystandby.com','aud-kid-qa@relaystandby.com','aud-doc-qa@relaystandby.com']) {
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
