/**
 * Shared domain enumerations — pg-free so they are safe to import into Client
 * Components (dropdowns, validation) as well as server modules. Mirrors the
 * CHECK constraints in db/migrations/001_initial.sql.
 *
 * Feature: relay-h0-mvp
 */

export const VALID_ROLES = ['recipient', 'executor', 'caregiver', 'partner'] as const;
export type RecipientRole = (typeof VALID_ROLES)[number];

export const VALID_TRIGGER_TYPES = ['emergency', 'travel', 'caregiver', 'business', 'estate'] as const;
export type TriggerType = (typeof VALID_TRIGGER_TYPES)[number];

/**
 * The trigger types a USER may create or fire today.
 *
 * Deliberately a SEPARATE list from VALID_TRIGGER_TYPES above, because the two
 * answer different questions. VALID_TRIGGER_TYPES is what the domain supports —
 * the release state machine, heartbeat blocking, grace windows and Property 7
 * all still handle `estate`, and any existing row keeps working. This list is
 * narrower: what a signed-in owner is permitted to choose.
 *
 * `estate` is excluded, and as of 2026-08-14 that exclusion is PERMANENT.
 *
 * ⚠️ THIS EXCLUSION USED TO BE TEMPORARY AND IS NOT ANY MORE. Gate
 * `g2-counsel-opinion` was DECLINED rather than met (PROJECT.yaml → gates →
 * g2-counsel-opinion.declined): no written opinion is being sought, so the
 * condition that would have re-opened this can never be satisfied. This is not
 * "not yet". There is no door.
 *
 * The original reason still stands and is worth keeping: src/app/terms/page.tsx
 * states "Estate and inheritance functionality is not offered", while /rules
 * once rendered its dropdown from VALID_TRIGGER_TYPES unfiltered — so the
 * product offered a permanent, irreversible capability its own Terms disclaimed,
 * on a surface that takes live payments.
 *
 * TO RE-OPEN, if it ever comes to that: reversing the declined decision in
 * PROJECT.yaml comes FIRST, in its own change, with its own argument — and only
 * then does moving 'estate' into this list mean anything. lib/ops/gates.test.ts
 * enforces that order; enums.test.ts stops the list widening by accident. The
 * acknowledgement path in /api/policies stays dormant rather than deleted,
 * because deleting it would make the reversal harder to review, not safer.
 *
 * ⚠️ AND THE HARD PART THIS DOES NOT SOLVE, so nobody mistakes it for cover:
 * closing the `estate` TRIGGER TYPE does not stop the product releasing after an
 * owner dies. runHeartbeatSweep arms every armed release for an overdue owner —
 * since 2026-08-21 restricted to the types in THIS list (`AND trigger_type =
 * ANY($2)`, lib/release/heartbeat.ts), so a withdrawn type can no longer be
 * started by the cron; this clause previously read "with no trigger_type filter"
 * and that half is now false — and nothing auto-closes a released state. The
 * conclusion is UNCHANGED and must not be softened: `emergency` is in this list,
 * so a deceased owner's emergency trigger still arms, still releases, and stays
 * released. The filter closed a withdrawn-capability leak, not this one. The
 * mitigations for THIS remain disclosure and copy, not this list. See the
 * `declined:` block in PROJECT.yaml.
 */
export const USER_SELECTABLE_TRIGGER_TYPES = [
  'emergency',
  'travel',
  'caregiver',
  'business',
] as const satisfies readonly TriggerType[];
export type UserSelectableTriggerType = (typeof USER_SELECTABLE_TRIGGER_TYPES)[number];

/** Narrowing guard for the trust boundary — routes throw, this only decides. */
export function isUserSelectableTriggerType(v: unknown): v is UserSelectableTriggerType {
  return (
    typeof v === 'string' &&
    (USER_SELECTABLE_TRIGGER_TYPES as readonly string[]).includes(v)
  );
}

export const VALID_SCOPES = ['view', 'act'] as const;
export type Scope = (typeof VALID_SCOPES)[number];

export const VALID_TYPES = ['login', 'account', 'document', 'note', 'instruction'] as const;
export type VaultItemType = (typeof VALID_TYPES)[number];

export const VALID_CATEGORIES = [
  'finance',
  'health',
  'government',
  'utilities',
  'communication',
  'professional',
  'personal',
  'other',
] as const;

export const VALID_CRITICALITY = ['critical', 'high', 'medium', 'low'] as const;
