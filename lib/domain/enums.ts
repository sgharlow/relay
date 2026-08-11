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
 * `estate` is excluded pending gate `g2-counsel-opinion` (PROJECT.yaml), which
 * requires a WRITTEN counsel opinion before any paying estate customer.
 * src/app/terms/page.tsx states "Estate and inheritance functionality is not
 * offered" — but /rules rendered its dropdown from VALID_TRIGGER_TYPES
 * unfiltered, so the product offered a permanent, irreversible capability its
 * own Terms disclaimed, on a surface that takes live payments.
 *
 * TO RE-ENABLE once counsel clears: move 'estate' into this list. The test in
 * enums.test.ts fails until it is deliberately updated, so this cannot widen by
 * accident — and the acknowledgement path in /api/policies is dormant, not
 * deleted, waiting for exactly that.
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
