/**
 * The prompted caregiver seed — 8 items.
 *
 * A blank vault is not a first-run experience. This is the archetype list an
 * adult child would actually need first if a parent were hospitalised tomorrow,
 * ordered so the credentials everything else resets through come first.
 *
 * Sized at 8 against the 10-item free cap so the risk-graph reveal fits inside
 * the tier with headroom — a reveal that needs more items than the free plan
 * allows is not a reveal (J1-R4).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R4
 */

export interface ChecklistEntry {
  id: string;
  label: string;
  hint: string;
  /** Must be one of the vault_items.category values. */
  category: string;
  /** Pre-ticks "everything else resets through this" in the wizard. */
  suggestedRoot: boolean;
}

export const CAREGIVER_CHECKLIST: readonly ChecklistEntry[] = [
  {
    id: 'primary-email',
    label: 'Their primary email',
    hint: 'The address most other accounts reset through',
    category: 'communication',
    suggestedRoot: true,
  },
  {
    id: 'phone-carrier',
    label: 'Their phone carrier account',
    hint: 'Where the two-factor texts arrive',
    category: 'communication',
    suggestedRoot: true,
  },
  {
    id: 'password-manager',
    label: 'Their password manager',
    hint: 'If they use one, it gates everything else',
    category: 'communication',
    suggestedRoot: true,
  },
  {
    id: 'primary-bank',
    label: 'Their main bank',
    hint: 'Where the bills are paid from',
    category: 'finance',
    suggestedRoot: false,
  },
  {
    id: 'health-insurance',
    label: 'Health insurance',
    hint: 'Member portal and policy number',
    category: 'health',
    suggestedRoot: false,
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy or patient portal',
    hint: 'Prescriptions and appointments',
    category: 'health',
    suggestedRoot: false,
  },
  {
    id: 'housing',
    label: 'Mortgage or rent',
    hint: 'The payment that cannot be missed',
    category: 'finance',
    suggestedRoot: false,
  },
  {
    id: 'utilities',
    label: 'Utilities',
    hint: 'Power, water, internet',
    category: 'utilities',
    suggestedRoot: false,
  },
] as const;
