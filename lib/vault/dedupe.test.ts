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

describe('two accounts at the same provider, which is what a CSV actually produces', () => {
  /*
    🔴 THE CASE THE SUITE COULD NOT REACH. "distinguishes two accounts at the
    same service" above uses DIFFERENT TITLES — 'Chase joint' vs 'Chase savings'
    — and a CSV import can never produce that. ImportPageClient maps
    `title: row.service_name, service_name: row.service_name`, so every row from
    an export has title === service_name, and two Google logins arrive as two
    identical labels.

    lib/import/csv-parser.ts keys ITS in-file dedupe on `service_name|url`, so
    both rows survive the parse exactly as J2-R5 asks. They were then collapsed
    on the server, and the response carried a count and no row identity — so a
    Bitwarden export with a personal and a work Google account imported one of
    them, and the owner read "left 1 already in your vault untouched" and had no
    way to know which credential was gone. This is the path the product
    recommends as how most people should start.
  */
  const login = (title: string, service_name: string, url: string | null) => ({ title, service_name, url });

  it('keeps two logins at the same provider when the urls differ', () => {
    const r = splitDuplicates(
      [login('Google', 'Google', 'https://mail.google.com'), login('Google', 'Google', 'https://ads.google.com')],
      [],
    );
    expect(r.fresh).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('still skips the same login on a re-import', () => {
    const r = splitDuplicates(
      [login('Google', 'Google', 'https://mail.google.com')],
      [login('Google', 'Google', 'https://mail.google.com')],
    );
    expect(r.fresh).toHaveLength(0);
    expect(r.duplicates).toHaveLength(1);
  });

  it('ignores case and trailing slashes in the url, as exports are inconsistent about both', () => {
    const r = splitDuplicates(
      [login('Chase', 'Chase', 'HTTPS://Chase.com/')],
      [login('Chase', 'Chase', 'https://chase.com')],
    );
    expect(r.duplicates).toHaveLength(1);
  });

  it('a url-less existing item still absorbs a row that has one', () => {
    /*
      ⚠️ THE REGRESSION THIS EXISTS TO PREVENT. Items added by hand at
      /vault/new carry no url. If a url simply joined the key, "Chase" typed in
      by hand would stop matching "Chase" from an export, and the first re-import
      after any manual add would DOUBLE those rows — the exact defect dedupe was
      written for. An absent url on either side is not evidence of a different
      account, so it falls back to the label match.
    */
    const r = splitDuplicates([login('Chase', 'Chase', 'https://chase.com')], [item('Chase', 'Chase')]);
    expect(r.fresh).toHaveLength(0);
    expect(r.duplicates).toHaveLength(1);
  });

  it('and the reverse: a url-less row matches an existing item that has one', () => {
    const r = splitDuplicates([item('Chase', 'Chase')], [login('Chase', 'Chase', 'https://chase.com')]);
    expect(r.duplicates).toHaveLength(1);
  });

  /*
    🔴 THE URL-LESS ABSORPTION LEAKED INTO THE BATCH, and it undid the fix above
    for the messiest exports — the ones most likely to hold two accounts at one
    provider. `remember()` ran on incoming rows as well as existing ones, so ONE
    incoming row with a blank url column set the bucket's `urlless` flag and
    every later row at that label was judged a duplicate of it, url or no url.

    The absorption is right against the EXISTING side and only there: a hand-made
    /vault/new item carries no url, and re-import idempotence depends on it still
    matching an export row that does. Nothing of the kind is true within one
    batch — lib/import/csv-parser.ts has already keyed its own in-file dedupe on
    `service_name|url` and kept both rows, so collapsing them here overrules a
    decision that was made correctly one layer up.
  */
  it('keeps both when only ONE of two rows at a provider carries a url', () => {
    const r = splitDuplicates(
      [login('Google', 'Google', null), login('Google', 'Google', 'https://mail.google.com')],
      [],
    );
    expect(r.fresh).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('keeps both in the other order too — the url-bearing row first', () => {
    const r = splitDuplicates(
      [login('Google', 'Google', 'https://mail.google.com'), login('Google', 'Google', null)],
      [],
    );
    expect(r.fresh).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });

  it('an EXISTING url-less item still absorbs the whole label — unchanged', () => {
    // The two rules differ per side, deliberately. This is the side that joins.
    const r = splitDuplicates(
      [login('Google', 'Google', 'https://mail.google.com'), login('Google', 'Google', null)],
      [item('Google', 'Google')],
    );
    expect(r.fresh).toHaveLength(0);
    expect(r.duplicates).toHaveLength(2);
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
