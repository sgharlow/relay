/**
 * Access-policy predicates over vault-item attributes.
 *
 * Today `access_rules` is one row per (vault_item_id x recipient_id x
 * trigger_type). At 300 items x 3 recipients that is up to 900 rows an owner
 * hand-creates, and every newly imported item lands uncovered by default,
 * silently. A policy is a predicate that materialises into those same rows.
 *
 * An EMPTY predicate matches NOTHING, deliberately. A match-anything default
 * would silently grant a recipient the entire vault — the inverse of the
 * coverage bug policies exist to fix (J4-R3).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3
 */

import { ValidationError } from '../validation';

export const CATEGORIES = [
  'finance',
  'health',
  'government',
  'utilities',
  'communication',
  'professional',
  'personal',
  'other',
] as const;

export const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;

export interface PolicyPredicate {
  categories?: string[];
  criticalities?: string[];
  isRootCredential?: boolean;
  irreplaceable?: boolean;
  minImportance?: number;
}

/** The non-secret columns a predicate is allowed to see (CC2). */
export interface PolicyItem {
  id: string;
  category: string | null;
  criticality: string | null;
  is_root_credential: boolean;
  irreplaceable: boolean;
  importance_score: number;
}

function isEmpty(p: PolicyPredicate): boolean {
  return (
    !p.categories?.length &&
    !p.criticalities?.length &&
    p.isRootCredential === undefined &&
    p.irreplaceable === undefined &&
    p.minImportance === undefined
  );
}

export function matchesPolicy(item: PolicyItem, p: PolicyPredicate): boolean {
  if (isEmpty(p)) return false;

  if (p.categories?.length) {
    if (!item.category || !p.categories.includes(item.category)) return false;
  }
  if (p.criticalities?.length) {
    if (!item.criticality || !p.criticalities.includes(item.criticality)) return false;
  }
  if (p.isRootCredential !== undefined && item.is_root_credential !== p.isRootCredential) {
    return false;
  }
  if (p.irreplaceable !== undefined && item.irreplaceable !== p.irreplaceable) {
    return false;
  }
  if (p.minImportance !== undefined && item.importance_score < p.minImportance) {
    return false;
  }

  return true;
}

export function selectMatching(items: PolicyItem[], p: PolicyPredicate): PolicyItem[] {
  return items.filter((i) => matchesPolicy(i, p));
}

function requireStringArray(
  raw: unknown,
  allowed: readonly string[],
  field: string,
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError(`${field} must be a non-empty array`, field);
  }
  for (const v of raw) {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      throw new ValidationError(`unknown ${field} value: ${String(v)}`, field);
    }
  }
  return raw as string[];
}

export function validatePolicyPredicate(raw: unknown): PolicyPredicate {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: PolicyPredicate = {};

  if (p.categories !== undefined) {
    out.categories = requireStringArray(p.categories, CATEGORIES, 'categories');
  }
  if (p.criticalities !== undefined) {
    out.criticalities = requireStringArray(p.criticalities, CRITICALITIES, 'criticalities');
  }

  for (const flag of ['isRootCredential', 'irreplaceable'] as const) {
    if (p[flag] !== undefined) {
      if (typeof p[flag] !== 'boolean') {
        throw new ValidationError(`${flag} must be a boolean`, flag);
      }
      out[flag] = p[flag] as boolean;
    }
  }

  if (p.minImportance !== undefined) {
    const v = p.minImportance;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
      throw new ValidationError('minImportance must be a number between 0.0 and 1.0', 'minImportance');
    }
    out.minImportance = v;
  }

  if (isEmpty(out)) {
    throw new ValidationError(
      'A policy must constrain at least one attribute. An empty policy would grant the whole vault.',
    );
  }

  return out;
}
