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
 * THE PURGE RULE, AND THE THREE WAYS IT WAS WRONG ON 2026-08-21.
 *
 * 1. IT SWALLOWED EVERY ERROR. The optional deletes sat in a bare `catch` that
 *    named one cause — "table absent in this deployment" — while tolerating all
 *    of them. A 40001 serialization failure, a 42501 permission denial of the
 *    031/032 class, or a dropped connection was ignored exactly like a missing
 *    table, and `DELETE FROM users` then ran regardless: 200 OK, a
 *    DeletionReport that never counted those rows, and no retry possible
 *    because the owner was gone. Now only 42P01 is tolerated — narrowed the way
 *    signin-attempts.ts and csp-report-store.ts narrow theirs — and every
 *    statement runs under `withOccRetry`, which every other write in this data
 *    layer already had and the one operation that cannot be repeated did not.
 *
 * 2. IT COULD NOT REACH TWO TABLES AT ALL. `verifier_confirmations` (keyed on
 *    release_state_id, no owner_id) and `consent_artifacts` (no owner_id; the
 *    delegations row is the only pointer) are reachable only THROUGH a row this
 *    function was deleting first. So every account closed through
 *    DELETE /api/account left its verifier attestations and consent records on
 *    the cluster, including the four purged on 2026-08-18. `recipient_codes`
 *    and `auth_challenges` were simply missed. The fixture scripts were more
 *    thorough than the product: reset-demo.ts and family-arc.ts already cleared
 *    the confirmations with the exact subquery now used below.
 *
 * 3. IT REACHED THEM AND THEN DID NOT COUNT THEM — found by review the same
 *    day, hours after (2) landed. Both new purges discarded what `purgeOne`
 *    returns, so `DeletionReport` accounted for neither while (1) above was
 *    already naming "a DeletionReport that never counted those rows" as part
 *    of the defect being corrected. For half a day that sentence described
 *    something still true. It is not cosmetic: this report IS the answer to
 *    the person leaving — `src/app/api/account` returns it verbatim — so a
 *    purge nobody counts is a purge nobody can see happened, on the one
 *    operation that cannot be run again to check.
 *
 * The ordering rule that falls out of it: anything reachable only through
 * another row goes BEFORE that row, and `users` goes last of all.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1, J13-R2
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { cancelSubscriptionForOwner } from '../billing/cancellation';
import { resignFromCircle } from '../people/resign';

/** `relation does not exist` — the one failure a closure is allowed to ignore. */
const UNDEFINED_TABLE = '42P01';

/**
 * One DELETE from the closure cascade: OCC-retried, tolerating ONLY 42P01.
 * Everything else propagates and stops the closure. See THE PURGE RULE above.
 */
async function purgeOne(sql: string, ownerId: string): Promise<number> {
  try {
    return await withOccRetry(async () => (await query(sql, [ownerId])).rowCount ?? 0);
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) return 0;
    throw err;
  }
}

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
  /**
   * The two purges reachable only THROUGH a row this function deletes first
   * (THE PURGE RULE (2)). Always a number, never absent — a tolerated 42P01
   * reports 0. Why they were missing from this report: see the call sites.
   */
  verifierConfirmations: number;
  consentArtifacts: number;
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

  const purge = (sql: string) => purgeOne(sql, ownerId);

  // BEFORE release_state — reachable only through it. See THE PURGE RULE (2).
  const verifierConfirmations = await purge(
    `DELETE FROM verifier_confirmations
      WHERE release_state_id IN (SELECT id FROM release_state WHERE owner_id = $1)`,
  );

  const releaseStates = await purge(`DELETE FROM release_state WHERE owner_id = $1`);
  const accessRules = await purge(`DELETE FROM access_rules WHERE owner_id = $1`);
  const vaultItems = await purge(`DELETE FROM vault_items WHERE owner_id = $1`);
  const recipients = await purge(`DELETE FROM recipients WHERE owner_id = $1`);
  const verifiers = await purge(`DELETE FROM verifiers WHERE owner_id = $1`);

  // A passkey is account data and the privacy page promises account data goes.
  // These outlived the user row until 2026-08-12: sign-in still failed safely,
  // because `authorize` looks the user up and finds nothing, but a public key
  // tied to a deleted person sat in the table with nothing left to delete it.
  const passkeys = await purge(`DELETE FROM webauthn_credentials WHERE user_id = $1`);

  // Same reachability problem as verifier_confirmations: consent_artifacts has
  // no owner_id (009), and the delegations row is the only pointer to it. So it
  // goes BEFORE the delegations delete below, not after.
  const consentArtifacts = await purge(
    `DELETE FROM consent_artifacts
      WHERE id IN (SELECT consent_artifact_id FROM delegations
                    WHERE owner_id = $1 OR delegate_user_id = $1)`,
  );

  for (const sql of [
    `DELETE FROM recovery_codes WHERE user_id = $1`,
    `DELETE FROM verifier_codes WHERE owner_id = $1`,
    // The recipient half of the same pair (017), and the higher-value one: a
    // recipient code opens the vault, where a verifier code answers a question.
    // 015 was cleared here from the start and 017 never was.
    `DELETE FROM recipient_codes WHERE owner_id = $1`,
    `DELETE FROM access_requests WHERE owner_id = $1`,
    `DELETE FROM delegations WHERE owner_id = $1 OR delegate_user_id = $1`,
    `DELETE FROM access_policies WHERE owner_id = $1`,
    `DELETE FROM approvals WHERE owner_id = $1`,
    `DELETE FROM subscriptions WHERE owner_id = $1`,
    // Unspent WebAuthn and step-up nonces (029). They are single-use and
    // expire, so this is retention rather than exposure — but the privacy page
    // says account data goes, and this is account data.
    `DELETE FROM auth_challenges WHERE user_id = $1`,
    // Outstanding invitations this owner issued. They carry a token hash and a
    // person id, and their roster rows have just been deleted, so leaving them
    // retains a credential for a circle that no longer exists.
    `DELETE FROM invitations WHERE owner_id = $1`,
    // Emergency codes this owner issued, for the same reason and more sharply:
    // a break-glass code is a live bearer credential with a one-year life, and
    // leaving one behind after the account is gone is the retention gap that was
    // already fixed for passkeys. Found 2026-08-12 while writing the privacy
    // page, which was about to claim these were removed.
    `DELETE FROM break_glass_codes WHERE owner_id = $1`,
  ]) {
    await purge(sql);
  }

  // LAST, and only because everything above returned. While the users row
  // survives, the closure is retryable; after it goes, nothing can find the
  // remaining rows to finish the job.
  await purge(`DELETE FROM users WHERE id = $1`);

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
    verifierConfirmations,
    consentArtifacts,
  };
}
