/**
 * The one path that records what an account demands.
 *
 * Extracted because a SECOND caller now exists — the prompt in the readiness
 * banner — and two hand-written fetches to the same endpoint drift: one sends
 * `null` where the other sends `[]`, and the difference between "stop
 * answering" and "a password is enough" is the difference between a question
 * and an answer. One definition, both callers.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { setFactorsRequired } from './declare-factors';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: { ok: boolean }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response as Response);
  });
  return calls;
}

describe('setFactorsRequired', () => {
  it('sends the answer to the item it is about', async () => {
    const calls = stubFetch({ ok: true });

    await setFactorsRequired('item-7', ['totp']);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/vault/items/item-7');
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ factors_required: ['totp'] });
  });

  it('keeps "a password is enough" distinct from "stop answering"', async () => {
    /*
      ⚠️ ABSENT IS NOT EMPTY, and this is the boundary where the two are easiest
      to confuse. `[]` is an owner's answer that the account demands nothing —
      it makes the item usable. `null` withdraws the answer and returns it to
      unasked. A caller that sent one for the other would silently change what
      the preparedness sentence claims.
    */
    const calls = stubFetch({ ok: true });

    await setFactorsRequired('item-7', []);
    await setFactorsRequired('item-7', null);

    expect(JSON.parse(String(calls[0].init.body))).toEqual({ factors_required: [] });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ factors_required: null });
  });

  it('throws a sentence an owner can read when the save fails', async () => {
    stubFetch({ ok: false });

    await expect(setFactorsRequired('item-7', ['totp'])).rejects.toThrow('Could not save that.');
  });
});
