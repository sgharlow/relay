/**
 * Delegation — a helper with scoped SETUP rights on another person's vault.
 *
 * The caregiver wedge has three roles the schema treats as one: the buyer
 * (adult child), the data owner (parent), and the recipient (the child again).
 * The parent stays the owner and the child becomes a delegate, which preserves
 * ownership, consent, reversibility, and the audit trail (J3-R1).
 *
 * THE HONEST BOUNDARY, and it must be stated to users in these words: a
 * delegate who types a credential in obviously knows it. The guarantee is that
 * a delegate cannot read items they did not personally enter, cannot arm or
 * disarm a trigger, cannot grant themselves access without the owner's
 * approval, and every action they take is logged and reported to the owner.
 * Never imply the delegate learns nothing.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R3, J3-R7
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { notifyOwnerOfDelegation } from '../notify/notifications';
import { formatOwnerLabel } from './owner-label';
import { ValidationError } from '../validation';

/**
 * The complete set of what a delegate may do. Deliberately contains no
 * decrypt, no trigger control, and no direct creation of recipients — a
 * delegate proposes, the owner approves (J3-R5, J3-R6).
 */
export const DELEGATE_SCOPES = [
  'items:create',
  'items:update',
  'import:run',
  'people:propose',
  'policies:propose',
] as const;

export type DelegateScope = (typeof DELEGATE_SCOPES)[number];

/** A parent without a smartphone must not be a blocker (J3-R3). */
export const CONSENT_METHODS = ['link', 'in_person', 'paper_upload'] as const;

export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/** Namespaces delegate actions in the audit log so they are distinguishable. */
export function delegateActor(delegationId: string): string {
  return `delegate:${delegationId}`;
}

export async function createDelegation(
  ownerId: string,
  delegateUserId: string,
): Promise<{ id: string; status: 'pending' }> {
  if (ownerId === delegateUserId) {
    throw new ValidationError('An owner cannot be their own delegate', 'delegateUserId');
  }

  const res = await query<{ id: string }>(
    `INSERT INTO delegations (owner_id, delegate_user_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id`,
    [ownerId, delegateUserId],
  );

  return { id: res.rows[0].id, status: 'pending' };
}

/**
 * Records the owner's consent and activates the delegation. Validation runs
 * BEFORE any write, so a bad method cannot leave a half-built artifact.
 */
export async function recordConsent(
  delegationId: string,
  input: { method: ConsentMethod; evidenceRef: string | null },
): Promise<{ status: 'active' }> {
  if (!CONSENT_METHODS.includes(input.method)) {
    throw new ValidationError(
      `consent method must be one of: ${CONSENT_METHODS.join(', ')}`,
      'method',
    );
  }

  const artifact = await query<{ id: string }>(
    `INSERT INTO consent_artifacts (method, evidence_ref)
     VALUES ($1, $2)
     RETURNING id`,
    [input.method, input.evidenceRef],
  );

  // Only a still-pending delegation activates: re-consenting a revoked one
  // must not silently bring it back.
  const updated = await query<{ id: string; owner_id: string }>(
    `UPDATE delegations
        SET status = 'active', granted_at = now(), consent_artifact_id = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING id, owner_id`,
    [delegationId, artifact.rows[0].id],
  );

  const row = updated.rows[0];
  if (!row) {
    throw new ValidationError('No pending delegation to consent to', 'delegationId');
  }

  await writeAuditEntry(row.owner_id, {
    actor: `owner:${row.owner_id}`,
    action: 'delegation_consent_recorded',
    entity: 'delegation',
    entityId: row.id,
    detail: { method: input.method, evidenceRef: input.evidenceRef },
  });

  // Tell the owner, in their own inbox, that someone now has setup rights on
  // their vault. Consent is already required before this point, so it cannot be
  // a surprise — but consent given verbally at a kitchen table leaves an older
  // owner nothing to find afterwards, and this is the message that says what
  // was agreed, what it does and does not permit, and how to end it. It is also
  // the honest check on a delegation model: the person whose vault it is always
  // gets told. Best-effort — a mail failure must not undo recorded consent.
  try {
    const parties = await query<{
      owner_email: string;
      delegate_name: string | null;
      delegate_email: string;
    }>(
      `SELECT o.email AS owner_email, d.display_name AS delegate_name, d.email AS delegate_email
         FROM delegations dg
         JOIN users o ON o.id = dg.owner_id
         JOIN users d ON d.id = dg.delegate_user_id
        WHERE dg.id = $1 LIMIT 1`,
      [row.id],
    );
    const p = parties.rows[0];
    if (p) {
      await notifyOwnerOfDelegation({
        ownerEmail: p.owner_email,
        delegateLabel: formatOwnerLabel(p.delegate_name, p.delegate_email),
        consentMethod: input.method,
      });
    }
  } catch (err) {
    process.stderr.write(`[delegation] consent notification failed: ${String(err)}\n`);
  }

  return { status: 'active' };
}

export async function getActiveDelegation(
  delegateUserId: string,
  ownerId: string,
): Promise<{ id: string; scopes: DelegateScope[] } | null> {
  const res = await query<{ id: string; scopes: DelegateScope[] }>(
    `SELECT id, scopes
       FROM delegations
      WHERE delegate_user_id = $1
        AND owner_id = $2
        AND status = 'active'
        AND revoked_at IS NULL
      LIMIT 1`,
    [delegateUserId, ownerId],
  );

  const row = res.rows[0];
  return row ? { id: row.id, scopes: row.scopes } : null;
}

/** Instant, from any authenticated owner surface (J3-R8). */
export async function revokeDelegation(ownerId: string, delegationId: string): Promise<void> {
  const res = await withOccRetry(() =>
    query<{ id: string }>(
      `UPDATE delegations
          SET status = 'revoked', revoked_at = now()
        WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [delegationId, ownerId],
    ),
  );

  if (res.rows.length === 0) return;

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'delegation_revoked',
    entity: 'delegation',
    entityId: delegationId,
  });
}
