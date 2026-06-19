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
