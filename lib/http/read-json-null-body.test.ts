/**
 * A body of literal `null`, and the six handlers that dereferenced it.
 *
 * 🔴 THE DEFECT. `JSON.parse('null')` succeeds and yields `null`, so `readJson`
 * returned `null` — not a 400, not a response, a value. Handlers written as
 *
 *     const parsed = await readJson(req);
 *     if (isResponse(parsed)) return parsed;
 *     const body = parsed as { code?: unknown };
 *     const code = typeof body.code === 'string' ? body.code : '';
 *
 * then threw `TypeError: Cannot read properties of null` on the next line. Four
 * bytes of request body — `null` — turned a handler into an unhandled 500.
 *
 * Six handlers carried that shape, and FOUR OF THEM ARE PUBLIC AND
 * UNAUTHENTICATED: `/api/access/code`, `/api/access/resend`, `/api/verify/code`
 * and `/api/verify/resend` — the two typed-code doors into a live release and
 * their two resend paths. The other two (`/api/account`, PATCH and DELETE, and
 * `/api/triggers/[id]/config`) need a session first. Nothing here was a
 * disclosure or a bypass: the handler dies before it decides anything, so the
 * cost is a 500 where a 400 was intended, plus an error-rate signal that reads
 * as a fault rather than as a malformed request.
 *
 * Found on 2026-08-22 by the first route test ever written against
 * `/api/verify/code`, which asserted a null body is refused with 400 and got a
 * TypeError instead.
 *
 * 🔴 THE PART WORTH KEEPING: THE HAZARD WAS ALREADY KNOWN AND FIXED IN THE
 * SIBLING. `readJsonOptional` ends `return out ?? {}`, and its own comment says
 * why — *"A body of literal `null` parses successfully to null; callers expect
 * an object to read optional fields off."* The author met this exact case,
 * wrote it down, and normalised ONE of the two helpers. Every caller of the
 * other one then had to remember, and six did not. That is the shape
 * `lib/ops/body-limit.ts` exists to catch stated in one sentence: a guard that
 * lives in a helper is a guard on the helper.
 *
 * So the fix is in `readJson`, not in six call sites — the guard goes where the
 * mistake happens. The tests below hold BOTH helpers to the same contract, so
 * the two cannot drift apart again in the direction that caused this.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readJson, readJsonOptional } from './owner-route';
import type { NextRequest } from 'next/server';

/** The bare double route tests use — no headers, no stream, just json(). */
function double(parsed: unknown): NextRequest {
  return { json: async () => parsed } as unknown as NextRequest;
}

/** A real streamed body, which is the path production actually takes. */
function streamed(payload: string): NextRequest {
  const bytes = new TextEncoder().encode(payload);
  return {
    headers: new Headers({ 'content-length': String(bytes.byteLength) }),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
    json: async () => JSON.parse(payload),
  } as unknown as NextRequest;
}

describe('readJson never hands a caller a value it cannot dereference', () => {
  it('normalises a literal null body to an empty object', async () => {
    expect(await readJson(streamed('null'))).toEqual({});
  });

  it('normalises it on the test-double path too, where there is no stream to read', async () => {
    expect(await readJson(double(null))).toEqual({});
  });

  it('normalises undefined — a double that returns nothing at all', async () => {
    expect(await readJson(double(undefined))).toEqual({});
  });

  /*
    The regression test proper. Every one of these is a real line from a handler
    that shipped: read a field off the parsed body without a `?? {}` first. With
    `null` coming back, each throws.
  */
  it('lets a handler read a field straight off the result without throwing', async () => {
    const parsed = (await readJson(streamed('null'))) as { code?: unknown };
    expect(() => typeof parsed.code === 'string').not.toThrow();
    expect(parsed.code).toBeUndefined();
  });

  it('leaves every other body shape exactly as it was', async () => {
    expect(await readJson(streamed('{"code":"ABCD"}'))).toEqual({ code: 'ABCD' });
    // Arrays are untouched: /api/import posts one, and `?? {}` must not become
    // "coerce anything that is not an object".
    expect(await readJson(streamed('[1,2,3]'))).toEqual([1, 2, 3]);
    // A falsy scalar is not null and must survive as itself, or a handler
    // reading `body === 0` would start seeing an object.
    expect(await readJson(streamed('0'))).toBe(0);
    expect(await readJson(streamed('false'))).toBe(false);
    expect(await readJson(streamed('""'))).toBe('');
  });

  it('still refuses malformed JSON with 400 rather than normalising it away', async () => {
    const out = await readJson(streamed('{ not json'));
    expect((out as Response).status).toBe(400);
  });
});

/*
  The two helpers differ ON PURPOSE in exactly one way — `readJsonOptional`
  turns a malformed body into `{}` where `readJson` returns 400, because six
  handlers legitimately accept no body at all. They must NOT differ on a null
  body, which is what this pair pins.
*/
describe('the two helpers agree on the case that caused this', () => {
  it.each([
    ['a literal null body', 'null'],
    ['an object body', '{"a":1}'],
  ])('%s reads the same through both', async (_label, payload) => {
    expect(await readJson(streamed(payload))).toEqual(await readJsonOptional(streamed(payload)));
  });

  it('and still differ where they are meant to: malformed JSON', async () => {
    expect((( await readJson(streamed('{ nope'))) as Response).status).toBe(400);
    expect(await readJsonOptional(streamed('{ nope'))).toEqual({});
  });
});
