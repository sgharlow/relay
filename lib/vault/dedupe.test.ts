/**
 * Tests for import de-duplication.
 *
 * The bias here is deliberate and worth stating: a missed duplicate is a
 * tidy-up, a wrongly-skipped row is a credential the family does not have
 * during an emergency. Every ambiguous case must import.
 *
 * Feature: relay-h0-mvp
 * Requirements: 10.4
 */

import { describe, it, expect } from 'vitest';

import { dedupeKey, splitDuplicates } from './dedupe';

const item = (title: string, service_name?: string | null) => ({ title, service_name });

describe('dedupeKey', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(dedupeKey(item('  Chase ', 'chase.com'))).toBe(dedupeKey(item('CHASE', 'Chase.com')));
  });

  it('collapses internal whitespace, which exports are inconsistent about', () => {
    expect(dedupeKey(item('Blue  Cross'))).toBe(dedupeKey(item('Blue Cross')));
  });

  it('treats a missing service name as empty rather than throwing', () => {
    expect(dedupeKey(item('Chase', null))).toBe(dedupeKey(item('Chase', undefined)));
  });

  it('distinguishes two accounts at the same service', () => {
    expect(dedupeKey(item('Chase joint', 'chase.com'))).not.toBe(
      dedupeKey(item('Chase savings', 'chase.com')),
    );
  });
});

describe('splitDuplicates', () => {
  it('imports everything into an empty vault', () => {
    const r = splitDuplicates([item('Chase'), item('Gmail')], []);
    expect(r.fresh).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('skips what the vault already holds', () => {
    const r = splitDuplicates([item('Chase'), item('Gmail')], [item('chase')]);
    expect(r.fresh.map((i) => i.title)).toEqual(['Gmail']);
    expect(r.duplicates.map((i) => i.title)).toEqual(['Chase']);
  });

  it('de-duplicates WITHIN the batch — exports repeat the same login', () => {
    const r = splitDuplicates([item('Gmail'), item('gmail'), item('GMAIL')], []);
    expect(r.fresh).toHaveLength(1);
    expect(r.duplicates).toHaveLength(2);
  });

  it('keeps the FIRST occurrence of an in-batch duplicate', () => {
    const r = splitDuplicates([item('Gmail', 'a'), item('Gmail', 'a')], []);
    expect(r.fresh[0].service_name).toBe('a');
  });

  it('a re-run of the same export adds nothing', () => {
    const batch = [item('Chase'), item('Gmail'), item('Blue Cross')];
    const r = splitDuplicates(batch, batch);
    expect(r.fresh).toHaveLength(0);
    expect(r.duplicates).toHaveLength(3);
  });

  it('imports the genuinely new rows from a refreshed export', () => {
    const existing = [item('Chase'), item('Gmail')];
    const refreshed = [item('Chase'), item('Gmail'), item('CVS'), item('Blue Cross')];
    const r = splitDuplicates(refreshed, existing);
    expect(r.fresh.map((i) => i.title)).toEqual(['CVS', 'Blue Cross']);
  });
});

describe('fail-open — never silently drop a secret', () => {
  it('imports an untitled row rather than matching it against another untitled one', () => {
    const r = splitDuplicates([item(''), item('')], [item('')]);
    expect(r.fresh).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('imports a whitespace-only title', () => {
    const r = splitDuplicates([item('   ')], [item('')]);
    expect(r.fresh).toHaveLength(1);
  });

  it('does not match on service name alone — that is a whole provider, not an account', () => {
    const r = splitDuplicates([item('Savings', 'chase.com')], [item('Checking', 'chase.com')]);
    expect(r.fresh).toHaveLength(1);
  });
});
