/**
 * Which refusals a family is allowed to read.
 *
 * 🔴 THE ONE MESSAGE WORTH SHOWING WAS THE ONE THROWN AWAY. dashboard.ts builds
 * "Not open yet — this one was set to open on Tue Sep 02 2026." and its own
 * comment says why that sentence exists: a recipient who was promised something
 * needs to know it is COMING, not conclude the plan is broken. The client
 * discarded it and rendered "could not be opened just now. Try again — if it
 * keeps happening, tell us so a person can look", telling somebody to retry
 * forever and report a bug against a staged delay doing precisely what the owner
 * configured.
 *
 * The opposite mistake is the dangerous one, so it is tested harder: surfacing
 * every message would put "Session is stale (release version changed)" and "Item
 * not in scope" in front of a frightened family member, and those are sentences
 * for us. `explainable` is the whole boundary, which is why it defaults to FALSE
 * — a denial added later is silent until somebody decides otherwise.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.8, J9
 */

import { describe, it, expect } from 'vitest';

import { AccessError } from './dashboard';

describe('AccessError.explainable', () => {
  it('defaults to false, so a new denial cannot leak by being forgotten', () => {
    // The safe default matters more than the feature: whoever adds the next
    // deny() gets silence unless they deliberately opt in.
    expect(new AccessError('Item not in scope', 403).explainable).toBe(false);
    expect(new AccessError('Session is stale (release version changed)', 403).explainable).toBe(false);
    expect(new AccessError('Release is not active', 403).explainable).toBe(false);
    expect(new AccessError('Item not found', 403).explainable).toBe(false);
  });

  it('carries the flag when a denial is meant for the person reading it', () => {
    const e = new AccessError('Not open yet — this one was set to open on Tue Sep 02 2026.', 403, true);
    expect(e.explainable).toBe(true);
    expect(e.httpStatus).toBe(403);
  });

  it('is still an Error with a working instanceof across the module boundary', () => {
    // setPrototypeOf is load-bearing here — the route branches on instanceof,
    // and without it every AccessError would fall through to a 500.
    const e = new AccessError('x', 403, true);
    expect(e).toBeInstanceOf(AccessError);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('x');
  });
});

/*
  The staged-delay denial is the only explainable one in the codebase today.
  This reads the source rather than exercising the path, because reaching it
  needs a released state, a matching access rule and a future release_after_days
  — and the property being pinned is about which denials opt in, which is a
  property of the source, not of one run.
*/
describe('the set of explainable denials', () => {
  it('is exactly the staged delay, and nothing has quietly joined it', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('lib/access/dashboard.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // Every deny(...) that opts in. Anything new here is a deliberate decision
    // and should fail this test until somebody confirms it is family-safe.
    const optIns = src.match(/deny\([\s\S]*?\btrue,?\s*\)/g) ?? [];
    expect(optIns).toHaveLength(1);
    expect(optIns[0]).toContain('Not open yet');
  });
});
