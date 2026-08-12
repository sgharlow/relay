/**
 * Demo seed inserter (Requirement 11.1).
 *
 * Inserts the dataset from `buildDemoData`, resolving string keys to generated
 * UUIDs and wiring `dependsOnKey` → `depends_on_item_id` in a second pass.
 * release_state rows are provisioned via `ensureReleaseState`.
 *
 * Seed ciphertext is a non-decryptable placeholder (see lib/seed/demo-data.ts).
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1, 7.4
 */

import { query } from '../db/connection';
import { ensureReleaseState } from '../release/provisioning';
import { upsertUser } from '../auth/upsert-user';
import { buildDemoData } from './demo-data';

/**
 * Bind a seeded contact to a standby account and set their person state.
 *
 * WHY THE DEMO NEEDS THIS AT ALL. Quorum tightened to `confirmed` on
 * 2026-08-12, and the seed left every contact at `invited` — so both demo
 * triggers became unsatisfiable and the account rendered the fatal readiness
 * banner. An account used to show people what the product does must not be a
 * demonstration of a broken plan.
 *
 * AND WHY IT BINDS RATHER THAN JUST WRITING 'confirmed'. Setting the state
 * without a `claimed_user_id` would seed a row the product itself can never
 * produce — `confirmPerson` only promotes from `claimed`, which only exists
 * once somebody has bound an identity. A fixture in an impossible state is how
 * code grows assumptions that hold everywhere except in the demo, and it would
 * also show a green light with no fingerprint behind it, which is precisely the
 * false green this codebase keeps producing.
 *
 * Idempotent: `upsertUser` keys on the auth sub, so reseeding reuses the same
 * standby rows rather than accumulating a new set each time.
 */
async function bindStandby(
  table: 'recipients' | 'verifiers',
  personId: string,
  email: string,
  state: 'invited' | 'claimed' | 'confirmed',
): Promise<void> {
  if (state === 'invited') return;

  const { id: userId } = await upsertUser(`standby:${email.trim().toLowerCase()}`, email);

  // Flagged as demo accounts so they are identifiable as fixtures. Without it
  // the seed quietly adds four rows to `users` that look exactly like real
  // signups — and the first metric anyone reaches for during a beta is how many
  // people signed up. A demo should not be able to inflate that number.
  await query(`UPDATE users SET is_demo_account = true WHERE id = $1`, [userId]);

  await query(
    `UPDATE ${table}
        SET claimed_user_id = $1,
            standby_state = $2,
            fingerprint_confirmed_at = ${state === 'confirmed' ? 'now()' : 'NULL'}
      WHERE id = $3`,
    [userId, state, personId],
  );
}

const CIPHERTEXT_PLACEHOLDER = Buffer.from('relay-demo-seed-placeholder');
const KMS_KEY_PLACEHOLDER = 'demo-seed';

export interface SeedResult {
  ownerId: string;
  items: number;
  recipients: number;
  verifiers: number;
  rules: number;
  releaseStates: number;
}

export async function seedDemo(): Promise<SeedResult> {
  const data = buildDemoData();

  // 1. Demo owner.
  // auth_sub MUST match the credentials provider's format (`credentials:<email>`,
  // see lib/auth/auth-options.ts) so signing in as the demo email lands on this
  // seeded row (ON CONFLICT keeps is_demo_account=true).
  const u = await query<{ id: string }>(
    `INSERT INTO users (email, auth_sub, is_demo_account, checkin_interval_days)
     VALUES ($1, $2, true, $3) RETURNING id`,
    [data.user.email, `credentials:${data.user.email}`, data.user.checkin_interval_days],
  );
  const ownerId = u.rows[0].id;

  // 2. Vault items (first pass — no dependency edges yet).
  const itemIdByKey = new Map<string, string>();
  for (const it of data.vaultItems) {
    const r = await query<{ id: string }>(
      `INSERT INTO vault_items
         (owner_id, type, title, service_name, url, category, criticality,
          is_root_credential, recurring_billing, irreplaceable, importance_score,
          backup_note, ciphertext, wrapped_data_key, kms_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        ownerId, it.type, it.title, it.service_name, it.url, it.category, it.criticality,
        it.is_root_credential, it.recurring_billing, it.irreplaceable, it.importance_score,
        it.backup_note, CIPHERTEXT_PLACEHOLDER, CIPHERTEXT_PLACEHOLDER, KMS_KEY_PLACEHOLDER,
      ],
    );
    itemIdByKey.set(it.key, r.rows[0].id);
  }

  // 3. Dependency edges (second pass).
  for (const it of data.vaultItems) {
    if (it.dependsOnKey) {
      await query(`UPDATE vault_items SET depends_on_item_id = $1 WHERE id = $2`, [
        itemIdByKey.get(it.dependsOnKey),
        itemIdByKey.get(it.key),
      ]);
    }
  }

  // 4. Recipients.
  const recipientIdByKey = new Map<string, string>();
  for (const rec of data.recipients) {
    const r = await query<{ id: string }>(
      `INSERT INTO recipients (owner_id, name, relationship, email, phone, role)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [ownerId, rec.name, rec.relationship, rec.email, rec.phone, rec.role],
    );
    recipientIdByKey.set(rec.key, r.rows[0].id);
    await bindStandby('recipients', r.rows[0].id, rec.email, rec.standby ?? 'invited');
  }

  // 5. Verifiers.
  for (const v of data.verifiers) {
    const r = await query<{ id: string }>(
      `INSERT INTO verifiers (owner_id, name, email, phone) VALUES ($1,$2,$3,$4) RETURNING id`,
      [ownerId, v.name, v.email, v.phone],
    );
    await bindStandby('verifiers', r.rows[0].id, v.email, v.standby ?? 'invited');
  }

  // 6. Access rules (keys resolved).
  for (const rule of data.rules) {
    await query(
      `INSERT INTO access_rules (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        ownerId,
        itemIdByKey.get(rule.vaultItemKey),
        recipientIdByKey.get(rule.recipientKey),
        rule.trigger_type,
        rule.scope,
        rule.reversible,
      ],
    );
  }

  // 7. Release states (ARMED).
  for (const rs of data.releaseStates) {
    await ensureReleaseState(ownerId, rs.trigger_type, { requiredConfirmations: rs.required_confirmations });
  }

  return {
    ownerId,
    items: data.vaultItems.length,
    recipients: data.recipients.length,
    verifiers: data.verifiers.length,
    rules: data.rules.length,
    releaseStates: data.releaseStates.length,
  };
}
