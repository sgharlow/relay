/**
 * A record the product promises must be a record the product shows.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, found 2026-08-17 by sweeping every table
 * for read/write asymmetry. `consent_artifacts` has existed since migration 009.
 * `recordConsent` inserts a row and links it via `delegations.consent_artifact_id`.
 * **Nothing anywhere ever read it back** — writes 1, reads 0, the only table in
 * the schema with that shape.
 *
 * Which matters because of what the screen that collects it says:
 *
 *     "This is kept as a record. It is what makes handing someone this help
 *      legitimate rather than simply convenient."
 *
 * An owner reads that, chooses "They signed something on paper", types "signed
 * form in the blue folder" — and the product never shows it again. The promise
 * was kept by the database and broken by the product. If anyone later asks how a
 * delegation was authorised, the answer exists and is unreachable.
 *
 * ⚠️ THE JOIN MUST BE A LEFT JOIN. A pending delegation has no artifact yet, and
 * an inner join silently drops exactly the rows the screen exists to act on —
 * the ones still waiting for consent. That failure would look like "the helper
 * disappeared", which is worse than the bug being fixed.
 *
 * Feature: relay-h0-mvp
 * Requirements: J3
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROUTE = 'src/app/api/delegations/route.ts';
const SCREEN = 'src/app/(owner)/approvals/HelperSection.tsx';
const WRITER = 'lib/people/delegation.ts';

function code(file: string): string {
  // Comments stripped: each of these files has to quote the defect to explain it.
  return readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('the consent record can be read back', () => {
  it('the delegations query selects the artifact', () => {
    expect(
      code(ROUTE),
      `${ROUTE} does not read consent_artifacts. The consent screen promises the record is kept; ` +
        'if nothing selects it, the promise is kept only by the database.',
    ).toMatch(/consent_artifacts/);
  });

  it('joins it as a LEFT JOIN, so pending delegations survive', () => {
    /*
      An inner join here drops every delegation that has not been consented to
      yet — which is the entire set the screen exists to act on. The bug would
      present as "the helper I just invited has vanished".
    */
    const src = code(ROUTE);
    expect(src, 'a pending delegation has no artifact and must not be filtered out').toMatch(
      /LEFT JOIN\s+consent_artifacts/i,
    );
  });

  it('the screen displays how consent was given', () => {
    const src = code(SCREEN);
    expect(src, 'the active delegation should show the consent method').toMatch(/consent_method/);
    expect(src, 'and the free-text note saying where the paper record is kept').toMatch(
      /consent_evidence_ref/,
    );
  });

  it('shows it only once consent exists', () => {
    // A pending delegation has nothing to show, and an empty "How you agreed"
    // heading would read as though the record had been lost.
    expect(code(SCREEN)).toMatch(/d\.status === 'active' && d\.consent_method/);
  });

  it('the writer still writes it — otherwise this guards nothing', () => {
    /*
      The other direction. If `recordConsent` stopped inserting the artifact, the
      checks above would keep passing against a column that is always null, and
      the screen would silently show nothing forever.
    */
    expect(code(WRITER), `${WRITER} should still insert the consent artifact`).toMatch(
      /INSERT INTO consent_artifacts/,
    );
    expect(code(WRITER), 'and still link it to the delegation').toMatch(/consent_artifact_id = \$/);
  });

  it('the promise that motivated this is still on the screen', () => {
    /*
      If that sentence is ever removed, this whole guard is arguing for a
      requirement nobody is making any more — and should be reconsidered rather
      than left running.
    */
    expect(readFileSync(SCREEN, 'utf8')).toMatch(/This is kept as a record/);
  });
});
