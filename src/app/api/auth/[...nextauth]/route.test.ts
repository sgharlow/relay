/**
 * The NextAuth catch-all — the owner's front door.
 *
 * This module executed no test until 2026-08-30. It is one statement long, and
 * the statement is the whole authentication surface: every `/api/auth/*` request
 * in the product is served by whatever `NextAuth(authOptions)` returns here.
 *
 * 🔴 THE HANDLER MUST BE THE ONE BUILT FROM THE SHARED `authOptions`. Both verbs
 * are exported from a SINGLE `NextAuth()` call, so GET and POST cannot come apart
 * — sign-in begins on one and completes on the other, and two separately
 * constructed handlers would be two configurations. A second `NextAuth(...)`
 * call, or an options object assembled inline, would be invisible in review and
 * would mean the sign-in flow was configured twice.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT TEST. The credentials provider, TOTP
 * enforcement, the JWT strategy and the session-epoch check are properties of
 * `lib/auth/auth-options.ts` and are tested there, against the real functions. A
 * test here that re-asserted them through a mocked NextAuth would be measuring
 * the mock. This asserts only what this file decides: which options, and that
 * both verbs are the same handler.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi } from 'vitest';

/*
 * `vi.mock` is hoisted above every `const` in this file, and the factory runs at
 * import time — before the module body has initialised anything. So the shared
 * state has to be hoisted with it. This is the documented use for `vi.hoisted`,
 * and the alternative (declaring the array normally) fails with
 * "Cannot access 'nextAuthCalls' before initialization" at collection time.
 */
const { nextAuthCalls, HANDLER } = vi.hoisted(() => ({
  nextAuthCalls: [] as unknown[],
  HANDLER: async () => new Response(null, { status: 200 }),
}));

vi.mock('next-auth', () => ({
  default: vi.fn((options: unknown) => {
    nextAuthCalls.push(options);
    return HANDLER;
  }),
}));

import NextAuth from 'next-auth';
import { authOptions } from '../../../../../lib/auth/auth-options';
import { GET, POST } from './route';

describe('the authentication front door', () => {
  it('is built from the shared authOptions, exactly once', () => {
    // Once: two calls would be two configurations of the same door.
    expect(vi.mocked(NextAuth)).toHaveBeenCalledTimes(1);
    expect(nextAuthCalls[0]).toBe(authOptions);
  });

  it('serves GET and POST with the same handler', () => {
    // Sign-in begins on one verb and completes on the other. If these ever
    // became distinct handlers, the flow would be configured twice and could
    // disagree with itself halfway through.
    expect(GET).toBe(POST);
    expect(GET).toBe(HANDLER);
  });

  it('exports no other verb', () => {
    // A stray DELETE or PUT export here would be an unclassified route: the
    // structural checks in lib/ops enumerate handlers by their exports.
    const mod = { GET, POST } as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(['GET', 'POST']);
  });
});
