/**
 * The funnel walk may not speak for the half it cannot see.
 *
 * See `lib/ops/funnel-instrument.ts`. On 2026-08-31 `verify:funnel` passed 7/7
 * and printed "the instrument is alive" while the Vercel Web Analytics API
 * answered `web_analytics_not_enabled` for the same project at the same moment.
 *
 * Feature: relay-g1-wtp
 * Requirements: A7.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verdict, collectionFromEnv, HOW_TO_CHECK_COLLECTION } from './funnel-instrument';

describe('the funnel verdict', () => {
  it('is green only when BOTH halves hold', () => {
    const v = verdict({ emitPassed: 7, emitTotal: 7, collection: 'enabled' });
    expect(v.code).toBe(0);
    expect(v.line).toMatch(/the instrument is alive/);
  });

  it('🔴 is a FINDING when every emit check passes and nothing collects', () => {
    /*
      The live state on 2026-08-31, and the case the whole module exists for. A
      page that fires flawlessly into a void is exactly as useful as one that
      fires nothing, and considerably more convincing.
    */
    const v = verdict({ emitPassed: 7, emitTotal: 7, collection: 'disabled' });
    expect(v.code).toBe(1);
    expect(v.line).toMatch(/NOTHING IS COLLECTING/);
    expect(v.notes.join(' ')).toMatch(/DO NOT LAUNCH A PLACEMENT/);
    expect(v.notes.join(' ')).toMatch(/cannot be re-collected/);
  });

  it('refuses to claim "alive" when the collection half was not checked', () => {
    const v = verdict({ emitPassed: 7, emitTotal: 7, collection: 'unknown' });
    expect(v.code).toBe(2);
    // The exact overclaim this replaces must not reappear as a green line.
    expect(v.line).not.toMatch(/the instrument is alive/);
    expect(v.line).toMatch(/the page FIRES correctly/);
    expect(v.notes.join(' ')).toContain(HOW_TO_CHECK_COLLECTION);
  });

  it('reports a failing emit half before anything else', () => {
    const v = verdict({ emitPassed: 5, emitTotal: 7, collection: 'enabled' });
    expect(v.code).toBe(1);
    expect(v.line).toMatch(/2 of 7 emit checks FAILED/);
  });

  it('never returns code 0 with notes, or a non-zero code without them', () => {
    // A finding with nothing to say is a finding nobody can act on.
    for (const collection of ['enabled', 'disabled', 'unknown'] as const) {
      for (const emitPassed of [7, 3]) {
        const v = verdict({ emitPassed, emitTotal: 7, collection });
        if (v.code === 0) expect(v.notes).toEqual([]);
        else expect(v.notes.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the collection state', () => {
  it('defaults to unknown, never to enabled', () => {
    /*
      🔴 A default that assumes the favourable answer is HOW the original
      overclaim happened. Silence about the second half is not evidence for it.
    */
    expect(collectionFromEnv(undefined)).toBe('unknown');
    expect(collectionFromEnv('')).toBe('unknown');
    expect(collectionFromEnv('   ')).toBe('unknown');
    expect(collectionFromEnv('yes please')).toBe('unknown');
  });

  it('reads the affirmative and negative forms a person would actually type', () => {
    for (const s of ['enabled', 'ENABLED', ' true ', '1']) expect(collectionFromEnv(s)).toBe('enabled');
    for (const s of ['disabled', 'False', '0']) expect(collectionFromEnv(s)).toBe('disabled');
  });
});

describe('the walk itself', () => {
  it('no longer prints an unqualified "the instrument is alive"', () => {
    /*
      The structural half. The pure verdict above can be correct while the script
      still hard-codes the old sentence somewhere — which is exactly the
      "a guard that lives in a helper is a guard on the helper" trap this
      directory is full of. So the script is read.

      The green line legitimately contains the phrase, but only with its
      condition attached ("...and collection is enabled — the instrument is
      alive"), and that string lives in the module, not in the script.
    */
    const src = readFileSync('scripts/verify-funnel.ts', 'utf8');
    const bare = /passed\s*—\s*the instrument is alive/.test(src);
    expect(
      bare,
      'scripts/verify-funnel.ts still declares the instrument alive from the emit checks alone. ' +
        'That sentence was true of the page and false of the pipeline on 2026-08-31, on the gate ' +
        'that decides whether the D2C branch survives.',
    ).toBe(false);
  });

  it('the walk asks the module for its verdict rather than computing one', () => {
    const src = readFileSync('scripts/verify-funnel.ts', 'utf8');
    expect(src).toMatch(/from '\.\.\/lib\/ops\/funnel-instrument'/);
    expect(src).toMatch(/verdict\(/);
  });
});
