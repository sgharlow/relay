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

import { FACTORS_DECLARED_EVENT, onFactorsDeclared, setFactorsRequired } from './declare-factors';

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

describe('the two surfaces are told, so neither is left stale', () => {
  /*
    🔴 THE DEFECT THIS CLOSES. `ReadinessBanner` (owner layout) and
    `VaultDashboardClient` (the vault page) both read this answer and both
    refresh only themselves. Answering in one left the other showing the old
    state until a reload — in the row-to-banner direction that meant the
    preparedness SENTENCE, the surface this codebase calls authoritative, kept
    a claim the owner had already superseded.

    The announcement fires from the seam rather than from each caller, so a
    third place to answer inherits it without its author knowing the other
    surfaces exist.
  */
  function listen(): { count: () => number; stop: () => void } {
    let n = 0;
    const stop = onFactorsDeclared(() => {
      n += 1;
    });
    return { count: () => n, stop };
  }

  it('announces a successful declaration', async () => {
    stubFetch({ ok: true });
    const l = listen();

    await setFactorsRequired('item-7', ['totp']);

    expect(l.count()).toBe(1);
    l.stop();
  });

  it('says NOTHING when the save failed', async () => {
    /*
      Announcing a failed save would refresh both surfaces into re-rendering the
      SAME unchanged state, which is indistinguishable on screen from the answer
      having been recorded. The error path must stay silent.
    */
    stubFetch({ ok: false });
    const l = listen();

    await expect(setFactorsRequired('item-7', ['totp'])).rejects.toThrow('Could not save that.');

    expect(l.count()).toBe(0);
    l.stop();
  });

  it('withdrawing an answer is announced too — it changes both surfaces as much as giving one', () => {
    return (async () => {
      stubFetch({ ok: true });
      const l = listen();

      await setFactorsRequired('item-7', null);

      expect(l.count()).toBe(1);
      l.stop();
    })();
  });

  it('unsubscribing actually stops delivery — the effect cleanup has to work', async () => {
    stubFetch({ ok: true });
    const l = listen();
    l.stop();

    await setFactorsRequired('item-7', []);

    expect(l.count()).toBe(0);
  });

  it('every subscriber hears it, not just the first', async () => {
    stubFetch({ ok: true });
    const a = listen();
    const b = listen();

    await setFactorsRequired('item-7', ['totp']);

    expect(a.count()).toBe(1);
    expect(b.count()).toBe(1);
    a.stop();
    b.stop();
  });

  it('the event name is stable — both listeners bind to this exact string', () => {
    // A rename that missed one subscriber would restore the stale surface
    // silently, with every test above still green.
    expect(FACTORS_DECLARED_EVENT).toBe('relay:factors-declared');
  });
});
