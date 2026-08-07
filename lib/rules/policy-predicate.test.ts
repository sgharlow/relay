/**
 * Tests for access-policy predicates.
 *
 * A policy is a predicate over item attributes. An EMPTY predicate must match
 * NOTHING — a match-anything default would silently grant a recipient the whole
 * vault, which is the inverse of the coverage bug policies exist to fix. This
 * repo has already shipped one match-anything resolver.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3
 */

import { describe, it, expect } from 'vitest';
import {
  matchesPolicy,
  selectMatching,
  validatePolicyPredicate,
  CATEGORIES,
  CRITICALITIES,
  type PolicyItem,
} from './policy-predicate';
import { ValidationError } from '../validation';

function item(p: Partial<PolicyItem> & { id: string }): PolicyItem {
  return {
    category: 'finance',
    criticality: 'high',
    is_root_credential: false,
    irreplaceable: false,
    importance_score: 0.5,
    ...p,
  };
}

describe('matchesPolicy', () => {
  it('matches on category', () => {
    expect(matchesPolicy(item({ id: 'a' }), { categories: ['finance'] })).toBe(true);
    expect(matchesPolicy(item({ id: 'a' }), { categories: ['health'] })).toBe(false);
  });

  it('matches any of several categories', () => {
    expect(matchesPolicy(item({ id: 'a' }), { categories: ['health', 'finance'] })).toBe(true);
  });

  it('matches on criticality', () => {
    const critical = item({ id: 'a', criticality: 'critical' });
    expect(matchesPolicy(critical, { criticalities: ['critical'] })).toBe(true);
    expect(matchesPolicy(critical, { criticalities: ['low'] })).toBe(false);
  });

  it('matches the root-credential flag in both directions', () => {
    expect(matchesPolicy(item({ id: 'a', is_root_credential: true }), { isRootCredential: true })).toBe(true);
    expect(matchesPolicy(item({ id: 'a', is_root_credential: false }), { isRootCredential: true })).toBe(false);
    expect(matchesPolicy(item({ id: 'a', is_root_credential: false }), { isRootCredential: false })).toBe(true);
  });

  it('matches the irreplaceable flag', () => {
    expect(matchesPolicy(item({ id: 'a', irreplaceable: true }), { irreplaceable: true })).toBe(true);
  });

  it('treats the importance floor as inclusive', () => {
    expect(matchesPolicy(item({ id: 'a', importance_score: 0.7 }), { minImportance: 0.7 })).toBe(true);
    expect(matchesPolicy(item({ id: 'a', importance_score: 0.69 }), { minImportance: 0.7 })).toBe(false);
  });

  it('ANDs every supplied clause', () => {
    const p = { categories: ['finance'], criticalities: ['critical'] };
    expect(matchesPolicy(item({ id: 'a', criticality: 'critical' }), p)).toBe(true);
    expect(matchesPolicy(item({ id: 'a', criticality: 'low' }), p)).toBe(false);
  });

  it('an EMPTY predicate matches NOTHING', () => {
    expect(matchesPolicy(item({ id: 'a' }), {})).toBe(false);
  });

  it('a predicate with only empty arrays also matches nothing', () => {
    expect(matchesPolicy(item({ id: 'a' }), { categories: [], criticalities: [] })).toBe(false);
  });

  it('a null attribute never matches a clause that constrains it', () => {
    expect(matchesPolicy(item({ id: 'a', category: null }), { categories: ['finance'] })).toBe(false);
    expect(matchesPolicy(item({ id: 'a', criticality: null }), { criticalities: ['high'] })).toBe(false);
  });
});

describe('validatePolicyPredicate', () => {
  it('rejects an empty predicate outright', () => {
    expect(() => validatePolicyPredicate({})).toThrow(ValidationError);
    expect(() => validatePolicyPredicate(null)).toThrow(ValidationError);
    expect(() => validatePolicyPredicate(undefined)).toThrow(ValidationError);
  });

  it('rejects an unknown category or criticality', () => {
    expect(() => validatePolicyPredicate({ categories: ['crypto'] })).toThrow(ValidationError);
    expect(() => validatePolicyPredicate({ criticalities: ['urgent'] })).toThrow(ValidationError);
  });

  it('rejects an empty array clause', () => {
    expect(() => validatePolicyPredicate({ categories: [] })).toThrow(ValidationError);
  });

  it('rejects minImportance outside [0,1] and non-numbers', () => {
    expect(() => validatePolicyPredicate({ minImportance: 1.5 })).toThrow(ValidationError);
    expect(() => validatePolicyPredicate({ minImportance: -0.1 })).toThrow(ValidationError);
    expect(() => validatePolicyPredicate({ minImportance: 'high' })).toThrow(ValidationError);
  });

  it('rejects non-boolean flags', () => {
    expect(() => validatePolicyPredicate({ isRootCredential: 'yes' })).toThrow(ValidationError);
  });

  it('accepts a well-formed predicate and drops unknown keys', () => {
    expect(
      validatePolicyPredicate({ categories: ['finance'], minImportance: 0.7, bogus: 1 }),
    ).toEqual({ categories: ['finance'], minImportance: 0.7 });
  });

  it('accepts every documented category and criticality', () => {
    expect(validatePolicyPredicate({ categories: [...CATEGORIES] }).categories).toHaveLength(
      CATEGORIES.length,
    );
    expect(
      validatePolicyPredicate({ criticalities: [...CRITICALITIES] }).criticalities,
    ).toHaveLength(CRITICALITIES.length);
  });

  it('accepts isRootCredential: false as a real constraint, not an empty one', () => {
    expect(() => validatePolicyPredicate({ isRootCredential: false })).not.toThrow();
  });
});

describe('selectMatching', () => {
  it('returns only matching items', () => {
    const items = [
      item({ id: 'a', category: 'finance' }),
      item({ id: 'b', category: 'health' }),
      item({ id: 'c', category: 'finance' }),
    ];
    expect(selectMatching(items, { categories: ['finance'] }).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for an empty predicate', () => {
    expect(selectMatching([item({ id: 'a' })], {})).toEqual([]);
  });
});
