/**
 * Tests for policy materialization.
 *
 * Materialization is a DIFF. Append-only materialization silently WIDENS access
 * on every policy edit — narrowing a policy would leave the old grants in place
 * (J4-R14).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R4, J4-R14, J4-R15
 */

import { describe, it, expect } from 'vitest';
import { diffGrants } from './policy-materialize';

describe('diffGrants', () => {
  it('adds newly matching items', () => {
    expect(diffGrants(['a', 'b'], ['a'])).toEqual({ toAdd: ['b'], toRemove: [] });
  });

  it('REVOKES items the policy no longer covers', () => {
    expect(diffGrants(['a'], ['a', 'b'])).toEqual({ toAdd: [], toRemove: ['b'] });
  });

  it('is a no-op when the sets already agree', () => {
    expect(diffGrants(['a', 'b'], ['b', 'a'])).toEqual({ toAdd: [], toRemove: [] });
  });

  it('revokes everything when the policy stops matching anything', () => {
    expect(diffGrants([], ['a', 'b'])).toEqual({ toAdd: [], toRemove: ['a', 'b'] });
  });

  it('adds everything on first materialization', () => {
    expect(diffGrants(['a', 'b'], [])).toEqual({ toAdd: ['a', 'b'], toRemove: [] });
  });

  it('deduplicates repeated ids on both sides', () => {
    expect(diffGrants(['a', 'a'], ['a'])).toEqual({ toAdd: [], toRemove: [] });
    expect(diffGrants(['a'], ['a', 'a'])).toEqual({ toAdd: [], toRemove: [] });
  });

  it('returns stable ordering so audit detail is deterministic', () => {
    expect(diffGrants(['c', 'a', 'b'], [])).toEqual({ toAdd: ['a', 'b', 'c'], toRemove: [] });
    expect(diffGrants([], ['c', 'a', 'b'])).toEqual({ toAdd: [], toRemove: ['a', 'b', 'c'] });
  });

  it('handles both sides empty', () => {
    expect(diffGrants([], [])).toEqual({ toAdd: [], toRemove: [] });
  });

  it('a widening and a narrowing in one edit are both reflected', () => {
    // Policy moved from {a,b} to {b,c}: c is added, a is revoked.
    expect(diffGrants(['b', 'c'], ['a', 'b'])).toEqual({ toAdd: ['c'], toRemove: ['a'] });
  });
});
