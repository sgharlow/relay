/**
 * Tests for the preparedness statement.
 *
 * This sentence sits on every owner screen and is the only number an owner
 * should care about, so it has to be true in the cases that matter — including
 * the ones where the honest answer is "none".
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

import { describe, it, expect } from 'vitest';

import { assessPreparedness, preparednessSentence, missingClause } from './preparedness';

const item = (id: string, over: Partial<{ title: string; criticality: string | null; is_root_credential: boolean }> = {}) => ({
  id,
  title: over.title ?? `Item ${id}`,
  criticality: over.criticality ?? null,
  is_root_credential: over.is_root_credential ?? false,
});

describe('what counts as mattering', () => {
  it('counts items marked critical and root credentials', () => {
    const p = assessPreparedness({
      items: [
        item('a', { criticality: 'critical' }),
        item('b', { is_root_credential: true }),
        item('c'),
      ],
      ruledItemIds: [],
      verifierCount: 1,
    });
    expect(p.mattering).toBe(2);
  });

  it('counts everything when nothing has been assessed yet', () => {
    // A brand-new vault has no scores. Reporting "0 things matter" would be a
    // reassuring lie on the emptiest possible vault.
    const p = assessPreparedness({
      items: [item('a'), item('b'), item('c')],
      ruledItemIds: [],
      verifierCount: 1,
    });
    expect(p.mattering).toBe(3);
  });
});

describe('what counts as reachable', () => {
  it('requires an access rule, not merely a recipient existing', () => {
    const p = assessPreparedness({
      items: [item('a', { criticality: 'critical' }), item('b', { criticality: 'critical' })],
      ruledItemIds: ['a'],
      verifierCount: 1,
    });
    expect(p.reachable).toBe(1);
    expect(p.mattering).toBe(2);
  });

  it('is not ready while anything that matters is unreachable', () => {
    const p = assessPreparedness({
      items: [item('a', { criticality: 'critical' })],
      ruledItemIds: [],
      verifierCount: 2,
    });
    expect(p.ready).toBe(false);
  });

  it('is not ready with no verifier, even when everything is covered', () => {
    // Covered but unconfirmable: the release would sit in PENDING forever.
    const p = assessPreparedness({
      items: [item('a', { criticality: 'critical' })],
      ruledItemIds: ['a'],
      verifierCount: 0,
    });
    expect(p.ready).toBe(false);
  });

  it('is ready when everything that matters is reachable and confirmable', () => {
    const p = assessPreparedness({
      items: [item('a', { criticality: 'critical' })],
      ruledItemIds: ['a'],
      verifierCount: 1,
    });
    expect(p.ready).toBe(true);
  });
});

describe('the sentence', () => {
  const p = (over: Partial<ReturnType<typeof assessPreparedness>>) =>
    ({
      reachable: 3,
      mattering: 5,
      unreachable: [],
      blocked: [],
      unchecked: 0,
      checkingStarted: false,
      gaps: [],
      ready: false,
      ...over,
    });

  it('names the person and the consequence', () => {
    expect(preparednessSentence(p({}), 'Sarah')).toBe(
      'If something happened tomorrow, Sarah could reach 3 of the 5 things that matter.',
    );
  });

  it('says "none" rather than "0 of 5"', () => {
    expect(preparednessSentence(p({ reachable: 0 }), 'Sarah')).toContain('could reach none of the 5');
  });

  it('says "all" when everything is covered', () => {
    expect(preparednessSentence(p({ reachable: 5 }), 'Sarah')).toContain('could reach all 5');
  });

  it('avoids the double negative when nobody is named', () => {
    // Found by looking at it: "nobody could reach none of the 3 things" is the
    // first sentence a new owner reads.
    const out = preparednessSentence(p({ reachable: 0, mattering: 3 }), 'nobody');
    expect(out).toBe('Nobody is named yet, so none of the 3 things that matter could be reached.');
    expect(out).not.toContain('nobody could reach none');
  });

  it('does not claim readiness on an empty vault', () => {
    expect(preparednessSentence(p({ mattering: 0, reachable: 0 }), 'Sarah')).toBe(
      'Nothing is in your vault yet, so there is nothing anyone could reach.',
    );
  });
});

describe('the missing clause', () => {
  it('is empty when nothing is missing', () => {
    expect(
      missingClause({
        reachable: 2,
        mattering: 2,
        unreachable: [],
        blocked: [],
        unchecked: 0,
        checkingStarted: false,
        gaps: [],
        ready: true,
      }),
    ).toBe('');
  });

  it('reads as a sentence, not a list dump', () => {
    expect(
      missingClause({
        reachable: 3,
        mattering: 5,
        unreachable: ['the phone carrier PIN'],
        blocked: [],
        unchecked: 0,
        checkingStarted: false,
        gaps: ['a second person who can confirm an emergency'],
        ready: false,
      }),
    ).toBe('Missing: the phone carrier PIN and a second person who can confirm an emergency.');
  });

  it('caps how many items it names', () => {
    const p = assessPreparedness({
      items: ['a', 'b', 'c', 'd', 'e'].map((i) => item(i, { criticality: 'critical' })),
      ruledItemIds: [],
      verifierCount: 2,
    });
    // Nine names is a wall, not a prompt.
    expect(p.unreachable.length).toBe(2);
  });
});

describe('🔴 small numbers — found by writing the user manual 2026-08-12', () => {
  it('says "both" rather than "all 2 of"', () => {
    // "all 2 of the things that matter" is how a template reads when nobody
    // checked the small numbers -- and small numbers are the COMMON case, since
    // the whole point of the importance engine is that four or five items
    // matter, not ninety.
    const p = {
      reachable: 2,
      mattering: 2,
      unreachable: [],
      blocked: [],
      unchecked: 0,
      checkingStarted: false,
      gaps: [],
      ready: true,
    };
    expect(preparednessSentence(p, 'Jordan')).toContain('both of the things that matter');
    expect(preparednessSentence(p, 'Jordan')).not.toContain('all 2');
  });

  it('says "the one thing" rather than "all 1 of"', () => {
    const p = {
      reachable: 1,
      mattering: 1,
      unreachable: [],
      blocked: [],
      unchecked: 0,
      checkingStarted: false,
      gaps: [],
      ready: true,
    };
    expect(preparednessSentence(p, 'Jordan')).toContain('the one thing that matters');
    expect(preparednessSentence(p, 'Jordan')).not.toContain('all 1');
  });

  it('still counts plainly from three up', () => {
    const p = {
      reachable: 7,
      mattering: 7,
      unreachable: [],
      blocked: [],
      unchecked: 0,
      checkingStarted: false,
      gaps: [],
      ready: true,
    };
    expect(preparednessSentence(p, 'Jordan')).toContain('all 7 of the things that matter');
  });
});

/*
  The second factor — the fix for the sentence being wrong in the direction that
  costs the most.

  "Reachable" meant "an access rule exists", so an owner storing the password
  for a 2FA-protected account was told Sarah could reach it. Sarah receives a
  password and a locked door. These tests pin the three states apart (Q1/Q3 of
  docs/secret-types-design.md): a door known to be locked, a door known to open,
  and a door nobody has checked — which is most of them, and must not be
  reported as either of the other two.
*/
describe('assessPreparedness — accounts that demand a second factor', () => {
  const base = { criticality: 'critical', is_root_credential: false, depends_on_item_id: null };

  it('does not count an item as reachable when the account demands a code nobody stored', () => {
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: 'password', factors_required: 'totp' },
        { id: '2', title: 'Bank', ...base, secret_kinds: 'password,totp', factors_required: 'totp' },
      ],
      ruledItemIds: ['1', '2'],
      verifierCount: 1,
    });

    expect(p.reachable).toBe(1);
    expect(p.mattering).toBe(2);
    expect(p.blocked).toEqual(['Gmail']);
    expect(p.ready).toBe(false);
  });

  it('counts an unchecked item as reachable, and says so rather than claiming it is fine', () => {
    // Absent is not empty. The item may be perfectly usable; nobody has asked.
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: 'password', factors_required: null },
        { id: '2', title: 'Bank', ...base, secret_kinds: 'password,totp', factors_required: 'totp' },
      ],
      ruledItemIds: ['1', '2'],
      verifierCount: 1,
    });

    expect(p.reachable).toBe(2);
    expect(p.unchecked).toBe(1);
    expect(p.blocked).toEqual([]);
  });

  it('leaves an all-unchecked vault exactly as it was before this existed', () => {
    /*
      🔴 THE ROLLOUT TRAP, AS A TEST. Every item in every existing vault has NULL
      for both columns, because no client has ever written them. If an unchecked
      item downgraded the sentence, every owner would be told on the same
      afternoon that their finished plan is no longer finished — over a
      measurement nobody has been asked for yet. That is the false alarm Q1
      forbids, and it would be the last time the signal was believed.
    */
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: null, factors_required: null },
        { id: '2', title: 'Bank', ...base, secret_kinds: null, factors_required: null },
      ],
      ruledItemIds: ['1', '2'],
      verifierCount: 1,
    });

    expect(p.reachable).toBe(2);
    expect(p.ready).toBe(true);
    expect(p.checkingStarted).toBe(false);
    expect(preparednessSentence(p, 'Sarah')).toBe(
      'If something happened tomorrow, Sarah could reach both of the things that matter.',
    );
  });

  it('adds the clause once checking has started and something is still unchecked', () => {
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: 'password', factors_required: '' },
        { id: '2', title: 'Bank', ...base, secret_kinds: null, factors_required: null },
        { id: '3', title: 'Utility', ...base, secret_kinds: null, factors_required: null },
      ],
      ruledItemIds: ['1', '2', '3'],
      verifierCount: 1,
    });

    expect(p.checkingStarted).toBe(true);
    expect(p.unchecked).toBe(2);
    expect(preparednessSentence(p, 'Sarah')).toBe(
      'If something happened tomorrow, Sarah could reach all 3 of the things that matter — ' +
        'though nobody has checked whether 2 of them need a code as well.',
    );
  });

  it('names a blocked item as needing a code, not as missing', () => {
    // "Missing: Gmail" would be false — the item is there. What is missing is
    // the code, and an owner who reads the wrong noun fixes the wrong thing.
    const p = assessPreparedness({
      items: [{ id: '1', title: 'Gmail', ...base, secret_kinds: 'password', factors_required: 'totp' }],
      ruledItemIds: ['1'],
      // Two verifiers, so the verifier gap does not also appear and this test
      // asserts one thing.
      verifierCount: 2,
    });

    expect(missingClause(p)).toBe('Missing: a code for Gmail, which nobody could supply.');
  });
});
