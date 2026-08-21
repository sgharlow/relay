/**
 * Every secret the product holds has a written rotation procedure — derived
 * from `.env.example`, not from a list somebody maintains.
 *
 * THE FINDING (`PROJECT.yaml → deferred → no-secret-rotation-runbook`, B8).
 * Eleven secrets sat in Vercel with no recorded age, no procedure and no owner,
 * and nothing in `docs/` rotated anything. Two of them cannot be rotated during
 * an open release without a doctor or an adult child meeting an error at the
 * moment a family is waiting, and nobody should be discovering that mid-incident.
 *
 * 🔴 WHY DERIVED, AND NOT A HANDWRITTEN LIST. A runbook is exactly the kind of
 * document that is complete on the day it is written and quietly wrong three
 * secrets later. This reads `.env.example` — which `env-example.test.ts` already
 * keeps honest against the code — and requires every secret-shaped variable to
 * appear in the runbook. Adding a secret without a procedure fails here.
 *
 * ⚠️ IT FOUND ONE IMMEDIATELY, which is the argument for its existence: the
 * first draft of the runbook covered eleven secrets and missed `DSQL_PASSWORD`.
 * That one turned out to be the most interesting of the twelve — it is a manual
 * override that should be EMPTY, and a value in it is a finding rather than a
 * chore.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNBOOK_PATH = join(process.cwd(), 'docs/secret-rotation-runbook.md');
const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

/*
  🔴 PROSE WRAPS, AND THIS FILE TRIPPED OVER IT ON ITS FIRST RUN. An assertion
  written as `/invalidates every outstanding link/i` went red against a runbook
  that says exactly that — because the phrase spans a line break, so the literal
  space in the pattern never matched.

  PROJECT.yaml records the identical failure with `gates.g3.dossier`: a path
  wrapped across two lines existed nowhere in the file as a contiguous string,
  so a grep-based guard "silently matched nothing" and passed. Same shape — and
  it failed LOUDLY here only because the phrase was expected to be PRESENT. An
  absence check written this way would have passed on a document that said the
  forbidden thing.

  So every multi-word match in this file goes through here.
*/
const wrapped = (phrase: string) => new RegExp(phrase.split(' ').join('\\s+'), 'i');

/** Anything that looks like a credential, by the name its own file gives it. */
function secretShapedVars(): string[] {
  return [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)]
    .map((m) => m[1]!)
    .filter((name) => /(SECRET|_KEY|API_KEY|PASSWORD|TOKEN)$/.test(name));
}

describe('every secret has a procedure', () => {
  it('the runbook exists', () => {
    expect(runbook.length).toBeGreaterThan(0);
  });

  it('covers every secret-shaped variable in .env.example', () => {
    const missing = secretShapedVars().filter((name) => !runbook.includes(name));

    expect(
      missing,
      missing.length
        ? 'These secrets exist and have no rotation procedure:\n' +
          missing.map((m) => `  ${m}`).join('\n') +
          '\n\nAdd a row and a section to docs/secret-rotation-runbook.md. Every secret here is ' +
          'signing or authenticating something in flight, and for two of them that in-flight ' +
          'thing is a family in an emergency — there is no secret in this product whose rotation ' +
          'is free.'
        : 'ok',
    ).toEqual([]);
  });

  it('finds a non-trivial number of them, so a broken regex cannot pass vacuously', () => {
    // A check that matches nothing passes. This is the guard on the guard.
    expect(secretShapedVars().length).toBeGreaterThan(8);
  });
});

describe('the two that reach a family in an emergency are called out', () => {
  it('names both link-signing secrets together', () => {
    expect(runbook).toContain('RECIPIENT_JWT_SECRET');
    expect(runbook).toContain('VERIFIER_JWT_SECRET');
  });

  it('says what rotating them costs, in the terms it actually costs', () => {
    expect(runbook).toMatch(wrapped('invalidates every outstanding link'));
    expect(runbook).toMatch(/emergency/i);
  });

  it('says when it is safe, and what to do when it is not', () => {
    // "Do not do it" would be the wrong answer for an implicated key. The
    // release state is the source of truth; the link is not.
    expect(runbook).toMatch(wrapped('release state is the source of truth'));
  });
});

describe('the ages are recorded, or their absence is', () => {
  it('has a last-set column', () => {
    expect(runbook).toContain('Last set');
  });

  /*
    🔴 THIS ASSERTED ONLY HALF THE PROPERTY, and the half it asserted expired.

    It required the runbook to say `"unknown" is a finding, not a blank` — which
    was exactly right while every age WAS unknown, and became a false requirement
    on 2026-08-21 when the ten Vercel-held ages were read from the Vercel API and
    the column was filled. A guard that fails when the defect it guards against
    is FIXED is a guard that pressures the next person into un-fixing it.

    What the describe block above actually promises is a disjunction: the ages are
    recorded, OR their absence is explained. So that is what is checked now. It
    cannot be satisfied by deleting the explanation and leaving blanks, and it
    cannot be satisfied by filling some rows and quietly dropping the sentence
    while others stay unknown — every remaining `unknown` still owes the reason.
  */
  it('records every age, or explains why an absent one is a finding', () => {
    const rows = runbook.split('\n').filter((l) => /^\| `[A-Z_]+`/.test(l));
    expect(rows.length, 'the secret table has no rows — the parser went blind').toBeGreaterThan(5);

    const stillUnknown = rows.filter((l) => /\|\s*unknown\s*\|/i.test(l));

    if (stillUnknown.length > 0) {
      expect(
        wrapped('"unknown" is a finding, not a blank').test(runbook),
        `${stillUnknown.length} row(s) still read "unknown" and the runbook no longer explains ` +
          'why that is a finding rather than a blank. Fill them, or restore the sentence.',
      ).toBe(true);
    } else {
      // Every age is on record. The claim that replaces it must say WHERE the
      // dates came from, because a date with no provenance is the next unknown.
      expect(
        runbook,
        'every age is filled but nothing says how they were established — a dated cell with no ' +
          'source is a number the next reader cannot check or refresh.',
      ).toMatch(/Vercel API|list-access-keys/i);
    }
  });
});

describe('the reader is sent here from where they will be standing', () => {
  it('the incident runbook points at it', () => {
    const incident = readFileSync(join(process.cwd(), 'docs/security-incident-runbook.md'), 'utf8');
    expect(incident).toContain('secret-rotation-runbook.md');
  });

  it('.env.example points at it, next to the first secret', () => {
    expect(envExample).toContain('secret-rotation-runbook.md');
  });
});
