/**
 * Sentences for audit actions — what `/audit` shows an owner instead of the raw
 * action string (gap plan GP-D2 / ROADMAP F-p, reclassified obliged on
 * 2026-09-13: the unlock "a real owner reads /audit" has been met since 08-29).
 *
 * THREE LABEL MAPS EXIST AND EACH OWNS ONE SURFACE. `VerifyClient.tsx`'s
 * `ACTION_LABEL` speaks to a VERIFIER about the release timeline and is bound to
 * `TIMELINE_ACTIONS` by `lib/ops/verify-timeline-is-labelled.test.ts`;
 * `lib/audit/incident-record.ts` narrates "what happened while you were away"
 * for the owner as a paragraph, not a row. This map speaks to the OWNER, one
 * row at a time, about every action the product can write. It is bound BOTH
 * WAYS to what the source emits by `lib/ops/audit-actions-are-labelled.test.ts`:
 * an action nobody emits cannot be labelled here, and an emitted action cannot
 * go unlabelled — the tautology revision 1 of the plan shipped is the shape
 * that test exists to refuse.
 *
 * `labelForAction` never throws and never hides: an unknown action comes back
 * unchanged, and the page prints the raw action on a visible second line
 * either way. The retired `estate` trigger type still has a historical action;
 * its sentence is neutral and past tense by ruling (GP-U13) — copy that offers
 * estate is a defect, copy that records it happened is a ledger.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.1, 8.6 (the log is readable by the owner it belongs to)
 */

export const LABELS: Readonly<Record<string, string>> = {
  // Vault
  vault_item_created: 'An item was added to the vault',
  vault_item_updated: 'An item was changed',
  vault_item_note_updated: 'An item’s note was changed',
  vault_item_deleted: 'An item was removed from the vault',
  vault_items_imported: 'Items were imported from a file',
  vault_item_decrypted: 'An item was revealed',
  vault_item_classification_overridden: 'The owner overrode how an item was classified',
  vault_item_factors_declared: 'The owner declared what an account demands to sign in',
  item_auto_covered: 'A new item was covered by an existing access rule',
  policy_materialized: 'A proposed access policy became access rules',
  kms_wrap_requested: 'A data key was wrapped for a new or changed item',
  kms_unwrap: 'A data key was unwrapped so an item could be revealed',
  kms_unwrap_denied: 'A request to reveal an item was refused',
  ai_intake: 'Item labels were sent for classification (never contents)',

  // Account
  account_exported: 'The vault was exported',
  account_deleted: 'The account was closed',
  account_recovered: 'The account was recovered with a recovery code',
  recovery_codes_regenerated: 'Recovery codes were regenerated',
  step_up_granted: 'The owner re-authenticated for a sensitive action',
  recipient_limits_acknowledged: 'The owner acknowledged the free-plan limits',
  estate_irreversibility_acknowledged:
    'Irreversibility was acknowledged for a trigger type that is no longer offered',

  // Circle
  invitation_created: 'Someone was invited to stand by',
  invitation_email_sent: 'An invitation email was sent',
  access_code_resent: 'An access code was sent again',
  standby_claimed: 'Someone claimed their standby account',
  standby_confirmed: 'The owner confirmed someone by the four-word call',
  standby_unconfirmed: 'The owner withdrew a confirmation',
  standby_claim_rejected: 'The owner rejected a claim',
  standby_rejected: 'Someone declined an invitation to stand by',
  standby_resigned: 'Someone left the circle',
  standby_marked_break_glass_only: 'A person was marked break-glass only',
  standby_unmarked_break_glass_only: 'A person was no longer break-glass only',
  break_glass_issued: 'A break-glass code was issued',
  break_glass_redeemed: 'A break-glass code was used',
  delegation_consent_recorded: 'Consent was recorded for a helper',
  delegation_revoked: 'A helper’s access was revoked',
  approval_requested: 'A helper proposed something for approval',
  approval_granted: 'The owner approved a helper’s proposal',
  approval_rejected: 'The owner rejected a helper’s proposal',

  // Check-in and release
  owner_checkin: 'The owner checked in',
  owner_checkin_reminder_first: 'A first check-in reminder was sent',
  owner_checkin_reminder_final: 'A final check-in reminder was sent',
  trigger_initiated: 'A release was started',
  trigger_stood_down: 'The owner stood a release down',
  release_transition_armed: 'The release returned to armed',
  release_transition_pending: 'The release moved to pending',
  release_transition_grace: 'The release entered its grace window',
  release_transition_released: 'Access was released',
  release_transition_cancelled: 'The release was cancelled',
  release_safe_reset_armed: 'A release was reset to armed after a conflict',
  release_halted_by_denial: 'A verifier’s denial halted the release',
  release_notice_undelivered: 'A release notice could not be delivered to a recipient',
  recipient_dashboard_viewed: 'A recipient opened their access page',

  // Verifiers and requests
  verifier_confirmed: 'A verifier confirmed',
  verifier_denied: 'A verifier denied',
  verifier_abstained: 'A verifier abstained',
  verifier_answer_not_counted: 'A verifier answered before being confirmed; it did not count',
  verifier_attestation_withdrawn: 'A verifier withdrew their answer',
  verifier_notice_resent: 'A verifier was notified again',
  verifier_silence_notified: 'The circle was told a verifier has not answered',
  access_requested: 'Someone asked for access',
  request_approved_by_owner: 'The owner approved an access request',
  request_denied_by_owner: 'The owner denied an access request',
  request_escalated_to_verifiers: 'An unanswered request was put to the verifiers',
  notification_suppressed: 'A notification was not sent',

  // Billing
  subscription_started: 'A subscription started',
  subscription_cancelled: 'A subscription was cancelled',
  renewal_payment_failed_notice: 'The owner was told a renewal payment failed',
  subscription_lapsed_notice: 'The owner was told the subscription ended',

  // Referential integrity (the cascade, recorded as Req 16.5 asks)
  ref_integrity_parent_not_found: 'A change referred to a record that does not exist and was refused',
  ref_integrity_owner_mismatch: 'A change crossed an ownership boundary and was refused',
  ref_integrity_cascade_delete: 'Dependent records were removed together',
  ref_integrity_uniqueness_enforced: 'A duplicate was refused',
};

/** A sentence for a known action; the raw action, unchanged, for an unknown one. */
export function labelForAction(action: string): string {
  return LABELS[action] ?? action;
}
