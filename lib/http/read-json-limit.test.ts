/**
 * The ceiling on a request body.
 *
 * 🔴 THERE WAS NONE until 2026-08-13. `readJson` called `req.json()` with no size
 * check and is shared by twenty-six route handlers, so the only bound anywhere
 * was Vercel's platform limit. The sharp case is `POST /api/access-requests`,
 * whose free-text `reason` comes from a standby contact — the actor
 * lib/release/access-request.ts already names as the threat.
 *
 * The pair of checks is the point. A declared Content-Length is cheap and lets
 * an oversized request die before the body is read, but it is a claim by the
 * SENDER; a chunked request declares nothing. Either check alone leaves the hole
 * open, so both are tested, including the case where they disagree.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readJson, MAX_JSON_BYTES } from './owner-route';
import type { NextRequest } from 'next/server';

/** A request whose body is a real stream, with whatever Content-Length we choose. */
function req(payload: string, declared?: number | null): NextRequest {
  const bytes = new TextEncoder().encode(payload);
  const headers = new Headers();
  if (declared !== null) headers.set('content-length', String(declared ?? bytes.byteLength));
  return {
    headers,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        // Chunked deliberately: a body that arrives in pieces is the shape the
        // stream check exists for.
        for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.slice(i, i + 4096));
        c.close();
      },
    }),
    json: async () => JSON.parse(payload),
  } as unknown as NextRequest;
}

const isResponse = (v: unknown): v is Response =>
  typeof v === 'object' && v !== null && 'status' in (v as Record<string, unknown>);

describe('readJson size limit', () => {
  it('parses an ordinary body unchanged', async () => {
    const out = await readJson(req(JSON.stringify({ reason: 'she fell' })));
    expect(out).toEqual({ reason: 'she fell' });
  });

  it('refuses an oversized body with 413, not 400', async () => {
    const out = await readJson(req(JSON.stringify({ reason: 'x'.repeat(MAX_JSON_BYTES + 1000) })));
    expect(isResponse(out)).toBe(true);
    expect((out as Response).status).toBe(413);
  });

  it('says what the limit is, so a caller can act on it', async () => {
    const out = (await readJson(
      req(JSON.stringify({ reason: 'x'.repeat(MAX_JSON_BYTES + 1000) })),
    )) as Response;
    expect((await out.json()).message).toMatch(/limit is \d+ KB/);
  });

  /*
    THE CASE A HEADER CHECK ALONE MISSES. A sender controls Content-Length. Here
    it lies — declaring a small body while streaming a large one — and the stream
    counter is the only thing standing between that and an unbounded read.
  */
  it('catches a body that LIES about its length', async () => {
    const huge = JSON.stringify({ reason: 'x'.repeat(MAX_JSON_BYTES + 1000) });
    const out = await readJson(req(huge, 12));
    expect((out as Response).status).toBe(413);
  });

  it('catches a body that declares NO length at all', async () => {
    const huge = JSON.stringify({ reason: 'x'.repeat(MAX_JSON_BYTES + 1000) });
    const out = await readJson(req(huge, null));
    expect((out as Response).status).toBe(413);
  });

  /*
    And the cheap path still works: an honest oversized declaration is refused
    before the body is read at all.
  */
  it('refuses on the declared length without reading the body', async () => {
    let read = false;
    const r = {
      headers: new Headers({ 'content-length': String(MAX_JSON_BYTES + 1) }),
      get body() {
        read = true;
        return null;
      },
      json: async () => ({}),
    } as unknown as NextRequest;
    expect(((await readJson(r)) as Response).status).toBe(413);
    expect(read, 'the body should never have been touched').toBe(false);
  });

  it('honours a per-route override, for the import path', async () => {
    const payload = JSON.stringify({ items: 'x'.repeat(MAX_JSON_BYTES + 1000) });
    expect(((await readJson(req(payload))) as Response).status).toBe(413);
    const out = await readJson(req(payload), 8 * 1024 * 1024);
    expect(isResponse(out)).toBe(false);
  });

  /*
    Route tests pass a double that is only `{ json: async () => body }`. It has no
    headers and no stream, so there is nothing to meter and the helper must fall
    through to json() rather than throw — which it did when the guard first went
    in, breaking twenty-three tests across six files in one run.
  */
  it('works with a bare test double that has no headers and no stream', async () => {
    const double = { json: async () => ({ ok: true }) } as unknown as NextRequest;
    expect(await readJson(double)).toEqual({ ok: true });
  });

  it('still returns 400 for malformed JSON that is within the limit', async () => {
    const out = await readJson(req('{ not json'));
    expect((out as Response).status).toBe(400);
  });
});
