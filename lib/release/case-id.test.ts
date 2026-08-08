/**
 * Tests for release case IDs.
 *
 * Three parties coordinating by phone during a crisis need one shared referent
 * that can be read aloud without ambiguity (CC7, J6-R11).
 *
 * Feature: relay-h0-mvp
 * Requirements: CC7, J6-R11
 */

import { describe, it, expect } from 'vitest';
import { formatCaseId, caseIdFor, CASE_ID_ALPHABET } from './case-id';

describe('formatCaseId', () => {
  it('is stable for the same seed', () => {
    expect(formatCaseId('abc')).toBe(formatCaseId('abc'));
  });

  it('matches the human-readable shape', () => {
    expect(formatCaseId('abc')).toMatch(/^RLY-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  it('omits characters that are ambiguous when read aloud', () => {
    // I/1, O/0, U (rhymes with 2) are excluded.
    for (const ch of 'IOU01') {
      expect(CASE_ID_ALPHABET).not.toContain(ch);
    }

    const ids = Array.from({ length: 300 }, (_, i) => formatCaseId(`seed-${i}`));
    for (const id of ids) {
      expect(id.slice(4)).not.toMatch(/[IOU01]/);
    }
  });

  it('differs across seeds', () => {
    expect(formatCaseId('a')).not.toBe(formatCaseId('b'));
  });

  it('has no collisions across many seeds', () => {
    const ids = new Set(Array.from({ length: 2000 }, (_, i) => formatCaseId(`release-${i}`)));
    expect(ids.size).toBe(2000);
  });

  it('handles a realistic UUID seed', () => {
    expect(formatCaseId('2d2dc6cf-e60a-431f-98cc-1c07e6cc8fcb')).toMatch(
      /^RLY-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/,
    );
  });

  it('handles an empty seed without throwing', () => {
    expect(formatCaseId('')).toMatch(/^RLY-/);
  });
});

describe('caseIdFor', () => {
  it('prefers a stored case_id', () => {
    expect(caseIdFor({ id: 'abc', case_id: 'RLY-AAAA-BBBB' })).toBe('RLY-AAAA-BBBB');
  });

  it('derives one for a pre-CC7 row with case_id NULL', () => {
    expect(caseIdFor({ id: 'abc', case_id: null })).toBe(formatCaseId('abc'));
  });

  it('derives one when the column is absent entirely', () => {
    expect(caseIdFor({ id: 'abc' })).toBe(formatCaseId('abc'));
  });

  it('never returns null or undefined', () => {
    for (const row of [{ id: 'x' }, { id: 'y', case_id: null }, { id: 'z', case_id: 'RLY-1111-2222' }]) {
      expect(caseIdFor(row)).toMatch(/^RLY-/);
    }
  });
});
