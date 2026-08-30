/**
 * A 401 is not an outage on the owner screens either.
 *
 * 🔴 THE SAME DEFECT, ON THE OTHER SIDE OF THE PRODUCT. StandbyClient records it
 * for the access group: "A 401 IS NOT AN OUTAGE, and until 2026-08-13 it was
 * reported as one… a message that says the product is broken, offers no door,
 * and arrives at exactly the moment this page exists for." /standby and /helping
 * were both given a signed-out door. Every owner screen still went through this
 * seam, which threw `Failed to load (401)`.
 *
 * So an owner returning to a tab left open past the session read, in clay text:
 *
 *     "Could not load your rules: Failed to load (401)"
 *     "Failed to load vault (401)"
 *     "Could not load your circle (401)"
 *
 * — an HTTP status code, no mention of signing in, an empty vault list, and a
 * readiness banner that renders `null` on no data and so vanishes entirely. Then
 * pressing "Fix this" or "Save" produced `Request failed (401)`.
 *
 * ⚠️ FIXED AT THE SEAM, NOT ON THE SCREENS, on purpose. Six owner clients call
 * these two functions and they do not all belong to one person's work; a fix in
 * each is a fix in the ones somebody remembered. Both helpers now throw
 * `SignedOutError`, whose message is the sentence a person needs — so a screen
 * that merely renders `err.message`, which is all of them, improves without being
 * touched, and a screen that wants the full door can test for the type.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { apiGet, apiSend, SignedOutError, signInHref, onOwnerWrite, announceOwnerWrite } from './api';

function stubFetch(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as never,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiGet', () => {
  it('reports a 401 as being signed out, not as a failure to load', async () => {
    stubFetch(401);
    await expect(apiGet('/api/vault/items')).rejects.toBeInstanceOf(SignedOutError);
  });

  it('says what happened and what to do, without an HTTP status code', async () => {
    stubFetch(401);
    const err = (await apiGet('/api/vault/items').catch((e: unknown) => e)) as Error;
    expect(err.message, 'a status code is not a sentence').not.toMatch(/401/);
    expect(err.message).toMatch(/signed out/i);
    expect(err.message, 'it must name the way back').toMatch(/sign (?:back )?in/i);
  });

  it('still reports a real outage as one', async () => {
    // The distinction is the whole point: a 500 IS something being wrong, and
    // telling somebody to sign in again would send them round a loop.
    stubFetch(500);
    const err = (await apiGet('/api/vault/items').catch((e: unknown) => e)) as Error;
    expect(err).not.toBeInstanceOf(SignedOutError);
    expect(err.message).toMatch(/500/);
  });

  it('returns the body on success', async () => {
    stubFetch(200, { items: [1, 2] });
    await expect(apiGet<{ items: number[] }>('/api/vault/items')).resolves.toEqual({ items: [1, 2] });
  });
});

describe('apiSend', () => {
  it('reports a 401 on a write as being signed out', async () => {
    /*
      The worse half. A read that fails looks broken; a WRITE that fails looks
      like the change was lost — and an owner who has just typed something and
      been told "Request failed (401)" has no way to know whether it saved.
    */
    stubFetch(401, {});
    await expect(apiSend('/api/rules', 'POST', { a: 1 })).rejects.toBeInstanceOf(SignedOutError);
  });

  it('still prefers the server’s own message on other failures', async () => {
    // The reason this helper exists — a 400 carries a sentence written for the
    // person, and it must keep winning over anything generic.
    stubFetch(400, { message: 'That rule already exists.' });
    const err = (await apiSend('/api/rules', 'POST', {}).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('That rule already exists.');
  });

  it('does not let a 401 body override the signed-out sentence', async () => {
    /*
      `{ message: 'Unauthorized' }` is what the API actually answers with, and it
      is developer vocabulary. Preferring the body here would have quietly put
      "Unauthorized" back on the screen and passed every other test in this file.
    */
    stubFetch(401, { message: 'Unauthorized' });
    const err = (await apiSend('/api/rules', 'POST', {}).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toMatch(/unauthorized/i);
  });
});

describe('signInHref', () => {
  it('carries the current page back as the callback', () => {
    expect(signInHref('/vault')).toBe('/auth/signin?callbackUrl=%2Fvault');
  });

  it('escapes a path with a query of its own', () => {
    expect(signInHref('/audit?page=2')).toBe('/auth/signin?callbackUrl=%2Faudit%3Fpage%3D2');
  });

  it('refuses to send anyone to another site', () => {
    /*
      An open redirect on a sign-in callback is how a phishing page borrows a
      real domain's front door. Only a path is ever accepted.
    */
    expect(signInHref('https://evil.example/x')).toBe('/auth/signin');
    expect(signInHref('//evil.example/x')).toBe('/auth/signin');
  });
});


/**
 * The banner that reads `/api/readiness` lives in the owner LAYOUT, which App
 * Router does not remount between pages. Without an announcement it kept its
 * first answer for the whole session — on 2026-08-29 that told a real owner
 * "Your vault is empty" while the page beneath listed the item he had just
 * added. These pin the announcement so it cannot be quietly dropped.
 */
describe('owner-write announcements', () => {
  it('announces after a successful write', async () => {
    let heard = 0;
    const off = onOwnerWrite(() => { heard += 1; });
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

    await apiSend('/api/recipients', 'POST', { name: 'April' });

    expect(heard).toBe(1);
    off();
  });

  /*
    The ordering that matters. Announcing a failed write would refresh the banner
    into showing the same unchanged state, which reads exactly like success —
    the same trap `setFactorsRequired` documents for the same reason.
  */
  it('does NOT announce when the write failed', async () => {
    let heard = 0;
    const off = onOwnerWrite(() => { heard += 1; });
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'nope' }), { status: 400 })) as typeof fetch;

    await expect(apiSend('/api/recipients', 'POST', {})).rejects.toThrow('nope');

    expect(heard).toBe(0);
    off();
  });

  it('does NOT announce when the session has expired', async () => {
    let heard = 0;
    const off = onOwnerWrite(() => { heard += 1; });
    globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;

    await expect(apiSend('/api/recipients', 'POST', {})).rejects.toBeInstanceOf(Error);

    expect(heard).toBe(0);
    off();
  });

  it('unsubscribes cleanly, so a remounted banner does not double-fetch', () => {
    let heard = 0;
    const off = onOwnerWrite(() => { heard += 1; });
    off();
    announceOwnerWrite();
    expect(heard).toBe(0);
  });
});
