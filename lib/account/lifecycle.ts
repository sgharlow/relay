/**
 * Leaving: taking your data out, and closing the account (J13).
 *
 * Both are written promises. The terms say we will give "a way to export what
 * you have stored", and the privacy page says we will delete your account and
 * vault contents on request, with the append-only event log as the one stated
 * exception. Neither existed, which made both documents inaccurate — and for a
 * product whose whole proposition is trust, an unfulfilled promise in the legal
 * text is worse than the missing feature.
 *
 * EXPORT RETURNS CIPHERTEXT, deliberately. The server cannot read vault
 * contents, so the only place a useful export can be assembled is the browser
 * that holds the ability to decrypt. This returns the material the client needs
 * — metadata, ciphertext, wrapped keys — and the client unwraps and decrypts to
 * build the file. A server-side "export" would either be a file full of
 * ciphertext, which is not what you have stored, or a plaintext path that
 * breaks the central guarantee.
 *
 * DELETE KEEPS THE AUDIT LOG, exactly as the privacy page states. That is not
 * an oversight to fix later: the log is append-only by design, it is what lets
 * an owner or a family prove what happened, and it holds no secret material.
 * The promise and the implementation must agree, so the code follows the
 * document rather than the other way round.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1, J13-R2
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { cancelSubscriptionForOwner } from '../billing/cancellation';
import { resignFromCircle } from '../people/resign';

export interface ExportedItem {
  id: string;
  type: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  criticality: string | null;
  importance_score: string | number | null;
  ciphertext: string;
  wrapped_data_key: string;
  created_at: string;
}

export interface AccountExport {
  exportedAt: string;
  owner: { email: string; display_name: string | null };
  items: ExportedItem[];
  recipients: Array<{ name: string; email: string; role: string }>;
  verifiers: Array<{ name: string; email: string }>;
  rules: Array<{ vault_item_id: string; recipient_id: string; trigger_type: string; scope: string; reversible: boolean }>;
}

/** Everything the owner put in, in the form the browser can finish decrypting. */
export async function buildAccountExport(ownerId: string): Promise<AccountExport> {
  const [owner, items, recipients, verifiers, rules] = await Promise.all([
    query<{ email: string; display_name: string | null }>(
      `SELECT email, display_name FROM users WHERE id = $1 LIMIT 1`,
      [ownerId],
    ),
    query<ExportedItem>(
      `SELECT id, type, title, service_name, url, category, criticality, importance_score,
              ciphertext, wrapped_data_key, created_at
         FROM vault_items WHERE owner_id = $1 ORDER BY created_at`,
      [ownerId],
    ),
    query<{ name: string; email: string; role: string }>(
      `SELECT name, email, role FROM recipients WHERE owner_id = $1 ORDER BY created_at`,
      [ownerId],
    ),
    query<{ name: string; email: string }>(
      `SELECT name, email FROM verifiers WHERE owner_id = $1 ORDER BY created_at`,
      [ownerId],
    ),
    query<{ vault_item_id: string; recipient_id: string; trigger_type: string; scope: string; reversible: boolean }>(
      `SELECT vault_item_id, recipient_id, trigger_type, scope, reversible
         FROM access_rules WHERE owner_id = $1`,
      [ownerId],
    ),
  ]);

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'account_exported',
    entity: 'user',
    entityId: ownerId,
    detail: { items: items.rows.length },
  });

  return {
    exportedAt: new Date().toISOString(),
    owner: { email: owner.rows[0]?.email ?? '', display_name: owner.rows[0]?.display_name ?? null },
    items: items.rows,
    recipients: recipients.rows,
    verifiers: verifiers.rows,
    rules: rules.rows,
  };
}

export interface DeletionReport {
  vaultItems: number;
  recipients: number;
  verifiers: number;
  accessRules: number;
  releaseStates: number;
  auditEntriesRetained: number;
  /** Passkeys removed from this account. */
  passkeys: number;
  /** Other people's circles this account was standing by for, now released. */
  standbyRolesReleased: number;
}

/**
 * Closes the account.
 *
 * The audit entry is written BEFORE the deletion so the log records that this
 * happened — writing it afterwards would depend on a row that no longer exists
 * to derive the actor from, and an unexplained gap in an append-only log is
 * exactly what such a log is supposed to prevent.
 */
export async function deleteAccount(ownerId: string): Promise<DeletionReport> {
  // FIRST, and deliberately so. The local subscriptions row was never what
  // charged the customer — Stripe was — and deleting it destroys the only
  // pointer to the Stripe object, making the charge unstoppable from inside
  // the app. If this throws, nothing below runs: "your vault is gone and you
  // are still being billed" is strictly worse than "we could not close your
  // account, try again".
  await cancelSubscriptionForOwner(ownerId);

  // SECOND, and before anything destructive, for the same reason billing goes
  // first: if this throws, the account is still intact and can be retried.
  //
  // A user is not only an owner (§3.7). They may also stand by for other people,
  // and those roles live in OTHER owners' rosters — rows this function's
  // `WHERE owner_id = $1` deletes never touch. Proven on production 2026-08-12:
  // after deleting a standby contact's account, the owner's roster still read
  // `standby_state = 'claimed'` pointing at a user id that no longer existed.
  //
  // For a continuity product that is the worst kind of wrong. The owner is shown
  // a covered circle, the readiness banner stays quiet, and the person it names
  // is gone — a failure that only reveals itself on the day it is needed.
  //
  // Deleting their account is leaving every circle, so it is expressed as
  // exactly that rather than as a bespoke UPDATE: `resignFromCircle` owns what
  // leaving means (unbind, degrade to `invited`, clear the fingerprint) and
  // writes the audit entry against the OTHER owner, which is how they find out.
  const standbyRoles = await query<{ person_id: string; person_type: 'recipient' | 'verifier' }>(
    `SELECT id AS person_id, 'recipient' AS person_type FROM recipients WHERE claimed_user_id = $1
     UNION ALL
     SELECT id AS person_id, 'verifier'  AS person_type FROM verifiers  WHERE claimed_user_id = $1`,
    [ownerId],
  );
  for (const role of standbyRoles.rows) {
    await resignFromCircle({
      userId: ownerId,
      personId: role.person_id,
      personType: role.person_type,
    });
  }

  const audit = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log WHERE owner_id = $1`,
    [ownerId],
  );

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'account_deleted',
    entity: 'user',
    entityId: ownerId,
    detail: { requestedAt: new Date().toISOString() },
  });

  const counted = async (sql: string): Promise<number> => {
    const r = await query(sql, [ownerId]);
    return r.rowCount ?? 0;
  };

  const releaseStates = await counted(`DELETE FROM release_state WHERE owner_id = $1`);
  const accessRules = await counted(`DELETE FROM access_rules WHERE owner_id = $1`);
  const vaultItems = await counted(`DELETE FROM vault_items WHERE owner_id = $1`);
  const recipients = await counted(`DELETE FROM recipients WHERE owner_id = $1`);
  const verifiers = await counted(`DELETE FROM verifiers WHERE owner_id = $1`);

  // A passkey is account data and the privacy page promises account data goes.
  // These outlived the user row until 2026-08-12: sign-in still failed safely,
  // because `authorize` looks the user up and finds nothing, but a public key
  // tied to a deleted person sat in the table with nothing left to delete it.
  const passkeys = await counted(`DELETE FROM webauthn_credentials WHERE user_id = $1`);

  // Best-effort for tables a given deployment may not have; a missing optional
  // table must not leave an account half-deleted.
  for (const sql of [
    `DELETE FROM recovery_codes WHERE user_id = $1`,
    `DELETE FROM verifier_codes WHERE owner_id = $1`,
    `DELETE FROM access_requests WHERE owner_id = $1`,
    `DELETE FROM delegations WHERE owner_id = $1 OR delegate_user_id = $1`,
    `DELETE FROM access_policies WHERE owner_id = $1`,
    `DELETE FROM approvals WHERE owner_id = $1`,
    `DELETE FROM subscriptions WHERE owner_id = $1`,
    // Outstanding invitations this owner issued. They carry a token hash and a
    // person id, and their roster rows have just been deleted, so leaving them
    // retains a credential for a circle that no longer exists.
    `DELETE FROM invitations WHERE owner_id = $1`,
  ]) {
    try {
      await query(sql, [ownerId]);
    } catch {
      /* table absent in this deployment */
    }
  }

  await query(`DELETE FROM users WHERE id = $1`, [ownerId]);

  return {
    vaultItems,
    recipients,
    verifiers,
    accessRules,
    releaseStates,
    // Retained on purpose, and stated on the privacy page. Reported so the
    // number is visible to the person leaving rather than a silent exception.
    auditEntriesRetained: Number(audit.rows[0]?.n ?? 0),
    passkeys,
    standbyRolesReleased: standbyRoles.rows.length,
  };
}
