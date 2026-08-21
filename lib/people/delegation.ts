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
 *
 * 🔴 `items:update` AND `import:run` REMOVED 2026-08-21, for exactly the reason
 * `policies:propose` was removed on 2026-08-12 (the note below). Nothing
 * anywhere called `requireScope(actor, 'items:update')` or
 * `requireScope(actor, 'import:run')`: `/api/import` is `requireOwner`, and
 * `PUT /api/vault/items/[id]` is owner-only. Every delegation ever created was
 * written with two capabilities no handler consults.
 *
 * ⚠️ AND `items:update` CONTRADICTED THE CONSENT ARTIFACT, which is what made it
 * worth closing rather than carrying. The panel an owner reads while deciding
 * whether to hand somebody a key to their vault says, in these words, that a
 * helper can never *"change or delete an item once it is in — only you can"*.
 * That sentence is what they consent to. The grant sat inert only because no
 * route asked — and the day one does, every delegation already consented to
 * under that sentence acquires edit rights over the owner's vault with no second
 * conversation and no notice. A latent capability that arrives without consent
 * is not a feature waiting to be finished; on this artifact it is a defect
 * waiting to fire.
 *
 * DROPPED RATHER THAN BUILT, and that direction is the safe one. Building them
 * would mean widening what a helper may do on vaults whose owners agreed to
 * something narrower — the copy would have to change too, and an owner who has
 * already signed cannot re-read it. Narrowing takes nothing away from anybody,
 * because nothing was ever honoured. If a helper genuinely needs to edit or to
 * import, that is a product decision with a re-consent step attached, not a
 * scope quietly restored to this array.
 *
 * `delegation.test.ts` reads every route handler and fails if this list ever
 * again names something no handler gates on — in either direction.
 */
export const DELEGATE_SCOPES = ['items:create', 'people:propose'] as const;

/**
 * Every scope name the enforcement layer must still be able to be ASKED about,
 * including the ones no longer granted.
 *
 * ⚠️ THIS IS NOT A GRANT LIST, and the difference is the whole point.
 * `createDelegation` writes `DELEGATE_SCOPES` into the row at creation time, so
 * rows created before a withdrawal still CARRY the retired string — every
 * delegation made before 2026-08-12 still names `policies:propose` in the
 * database today. `requireScope` has to be able to name and refuse those, and
 * `getActiveDelegation` has to be able to recognise them in order to drop them.
 * A type that admitted only what is currently granted would make the retired
 * values unspeakable in the very code whose job is to reject them.
 */
export const KNOWN_DELEGATE_SCOPES = [
  ...DELEGATE_SCOPES,
  'items:update',
  'import:run',
  'policies:propose',
] as const;

/**
 * 🔴 `policies:propose` REMOVED 2026-08-12. It was granted to every delegate,
 * offered by no surface, and `decideApproval` claimed a `policy` approval
 * without applying one — so an owner could have "approved" a proposal and had
 * nothing happen. A granted capability that silently does nothing is worse than
 * an absent one, because it reads as working.
 *
 * DROPPED RATHER THAN BUILT, because it does not fit the read boundary it would
 * have to live inside. A policy says "this person may reach that item", and a
 * helper can see neither side of it: J3-R4 limits them to the items they
 * personally entered, and nothing lists the owner's recipients to them. Building
 * it honestly would mean showing a helper the owner's circle — widening the
 * boundary to serve a feature nobody asked for, in the one place the product is
 * most careful.
 *
 * The `policy` approval KIND is deliberately kept (below): zero exist, but a row
 * that appears from an older deployment must still render and still be
 * rejectable. It simply cannot be created or approved any more.
 */

export type DelegateScope = (typeof KNOWN_DELEGATE_SCOPES)[number];

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

  /**
   * 🔴 THE DELEGATE MUST ALREADY BE IN THIS OWNER'S CIRCLE, added by the
   * 2026-08-12 security review after the create UI shipped.
   *
   * This accepted ANY user id. Not exploitable — a UUID is unguessable, the
   * delegate is never notified, and without the owner's id they cannot act — so
   * the practical worst case was an owner harming only themselves. What made it
   * worth closing is what delegation RESTS on: the consent artifact (J3-R2) is
   * the single thing separating "a helper" from "a stranger with write access to
   * someone's vault", and an owner could record "we agreed in person" about a
   * person they had never named. A false artifact is worse than no artifact,
   * because it looks like the control working.
   *
   * The UI has always offered circle members only; this makes that the rule
   * rather than a rendering choice.
   *
   * ⚠️ LIMITATION THIS BAKES IN, deliberately and reversibly: a helper who is
   * NOT also a recipient or verifier — a paid organiser, say — has to be named
   * in the circle first, which grants more than intended. If that case matters,
   * the answer is a third person type, not a looser API.
   */
  const inCircle = await query<{ id: string }>(
    `SELECT id FROM recipients
      WHERE owner_id = $1 AND claimed_user_id = $2
        AND coalesce(standby_state, 'invited') <> 'revoked'
      UNION
     SELECT id FROM verifiers
      WHERE owner_id = $1 AND claimed_user_id = $2
        AND coalesce(standby_state, 'invited') <> 'revoked'
      LIMIT 1`,
    [ownerId, delegateUserId],
  );
  if (inCircle.rows.length === 0) {
    throw new ValidationError(
      'A helper must be someone you have already named who has accepted',
      'delegateUserId',
    );
  }

  /**
   * Scopes are STATED, not inherited. Migration 009 defaults this column to a
   * five-scope list that still contains `policies:propose`; leaving the default
   * to speak would mean the database granting a capability the application has
   * removed, which is the two-definitions drift that put an email address on the
   * standby dashboard. `DELEGATE_SCOPES` is the one authoritative answer to what
   * a helper may do, so it is what gets written.
   */
  const res = await query<{ id: string }>(
    `INSERT INTO delegations (owner_id, delegate_user_id, status, scopes)
     VALUES ($1, $2, 'pending', $3::jsonb)
     RETURNING id`,
    [ownerId, delegateUserId, JSON.stringify(DELEGATE_SCOPES)],
  );

  return { id: res.rows[0].id, status: 'pending' };
}

/**
 * Records the owner's consent and activates the delegation. Validation runs
 * BEFORE any write, so a bad method cannot leave a half-built artifact.
 */
export async function recordConsent(
  delegationId: string,
  input: {
    method: ConsentMethod;
    evidenceRef: string | null;
    /**
     * The owner whose delegation this is.
     *
     * 🔴 ADDED 2026-08-12 BY THE SECURITY REVIEW. This function previously took
     * no owner at all and activated `WHERE id = $1 AND status = 'pending'`, while
     * the route authenticated a user and passed the path id straight through
     * with no `assertOwns`. Any signed-in user could therefore activate ANY
     * pending delegation — granting a stranger setup rights over somebody else's
     * vault, and defeating the consent step that is the entire control making
     * delegation legitimate (J3).
     *
     * Unguessable UUIDs made it hard to exploit rather than safe. This data
     * layer has no foreign keys, so a cross-owner reference is refused in the
     * application or not at all — which is precisely why the convention exists.
     */
    ownerId: string;
  },
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
      WHERE id = $1 AND owner_id = $3 AND status = 'pending'
      RETURNING id, owner_id`,
    [delegationId, artifact.rows[0].id, input.ownerId],
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
  const res = await query<{ id: string; scopes: DelegateScope[] | null }>(
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
  if (!row) return null;

  /**
   * 🔴 THE STORED SCOPES ARE NARROWED HERE, AND THIS IS THE GUARD THAT MATTERS.
   *
   * `createDelegation` writes `DELEGATE_SCOPES` into the row at creation time,
   * so withdrawing a scope from that constant does nothing at all to the rows
   * already in the database — `policies:propose` was removed on 2026-08-12 and
   * every delegation created before then still names it, `items:update` and
   * `import:run` were removed on 2026-08-21 and every delegation ever created
   * names both. `requireScope` asks the ROW, not the list, so a fix that only
   * edited the constant would look complete in the diff and change nothing for
   * anyone who already has a helper.
   *
   * The guard therefore sits at the one place a stored scope enters the running
   * system, rather than in a comment asking the next caller to remember. Its
   * consequence is the one that counts: on the day somebody wires
   * `requireScope(actor, 'items:update')` to a handler, an old row cannot smuggle
   * in an edit right its owner was explicitly promised no helper would ever have.
   *
   * An unreadable column grants NOTHING — the same rule `readStandbyState`
   * applies to person state, for the same reason. A row is never more trusted
   * than its data, and a corrupt `scopes` value must fail toward least
   * privilege, never toward the default in migration 009.
   */
  const granted = new Set<string>(DELEGATE_SCOPES);
  const scopes = (Array.isArray(row.scopes) ? row.scopes : []).filter((s): s is DelegateScope =>
    granted.has(s),
  );

  return { id: row.id, scopes };
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
