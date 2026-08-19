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

import {
  assessPreparedness,
  preparednessSentence,
  missingClause,
  undeclaredClause,
} from './preparedness';

const item = (id: string, over: Partial<{ title: string; criticality: string | null; is_root_credential: boolean }> = {}) => ({
  id,
  title: over.title ?? `Item ${id}`,
  criticality: over.criticality ?? null,
  is_root_credential: over.is_root_credential ?? false,
  // Required since 2026-08-18, and writing them down is the point: a caller
  // that omits them is a caller whose query forgot the columns.
  secret_kinds: null,
  factors_required: null,
  depends_on_item_id: null,
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
      unasked: 0,
      undeclared: 0,
      unresolved: 0,
      unaskedItems: [],
      undeclaredItems: [],
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
        unasked: 0,
      undeclared: 0,
      unresolved: 0,
      unaskedItems: [],
      undeclaredItems: [],
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
        unasked: 0,
      undeclared: 0,
      unresolved: 0,
      unaskedItems: [],
      undeclaredItems: [],
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
      unasked: 0,
      undeclared: 0,
      unresolved: 0,
      unaskedItems: [],
      undeclaredItems: [],
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
      unasked: 0,
      undeclared: 0,
      unresolved: 0,
      unaskedItems: [],
      undeclaredItems: [],
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
      unasked: 0,
      undeclared: 0,
      unresolved: 0,
      unaskedItems: [],
      undeclaredItems: [],
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
    expect(p.unasked).toBe(1);
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
    expect(p.unasked).toBe(2);
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

/*
  🔴 WHY `unchecked` WAS NOT ONE NUMBER, found on 2026-08-18 while designing the
  prompt that finally ASKS the question (D3).

  `itemUsability` returns `unknown` for two completely different situations with
  two completely different remedies, and the old single count hid the difference:

    - nobody has asked what the account demands — one tap answers it;
    - the owner HAS said it demands a code, and no client ever declared what the
      entry holds. Every item created before 2026-08-18 is in this state, and it
      cannot be answered by tapping anything. The server cannot read ciphertext,
      and `updateItemSecret` REPLACES the payload, so the only way to record what
      an item holds is the owner re-entering it.

  Without the split, an owner taps "Needs a code", the item stays `unknown`, the
  count does not move, and the sentence still says nobody has checked — an answer
  that visibly does nothing is an answer given once and never again.
*/
describe('assessPreparedness — why an item is unchecked, not just how many', () => {
  const base = { criticality: 'critical', is_root_credential: false, depends_on_item_id: null };

  it('separates the question nobody asked from the answer Relay cannot verify', () => {
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: null, factors_required: null },
        { id: '2', title: 'Bank', ...base, secret_kinds: null, factors_required: 'totp' },
        { id: '3', title: 'Utility', ...base, secret_kinds: 'password,totp', factors_required: 'totp' },
      ],
      ruledItemIds: ['1', '2', '3'],
      verifierCount: 1,
    });

    expect(p.unasked).toBe(1);
    expect(p.undeclared).toBe(1);
  });

  it('names the items, because a count is not something an owner can act on', () => {
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: null, factors_required: null },
        { id: '2', title: 'Bank', ...base, secret_kinds: null, factors_required: 'totp' },
      ],
      ruledItemIds: ['1', '2'],
      verifierCount: 1,
    });

    expect(p.unaskedItems).toEqual([{ id: '1', title: 'Gmail' }]);
    expect(p.undeclaredItems).toEqual([{ id: '2', title: 'Bank' }]);
  });

  it('caps each list at two, on the same reasoning as every other named list here', () => {
    const p = assessPreparedness({
      items: ['1', '2', '3'].map((id) => ({
        id,
        title: `Item ${id}`,
        ...base,
        secret_kinds: null,
        factors_required: null,
      })),
      ruledItemIds: ['1', '2', '3'],
      verifierCount: 1,
    });

    expect(p.unasked).toBe(3);
    expect(p.unaskedItems).toHaveLength(2);
  });

  it('accounts for every unchecked item, so none falls silently out of the count', () => {
    /*
      The invariant that makes the split safe. An item can also be `unknown`
      because the item it recovers THROUGH is unknown — a third cause, with its
      own remedy (answer the root), which prompts on a different row. If the
      three buckets did not sum, an item would vanish from both the sentence and
      the prompt, which is the silent-falsehood shape this whole module exists
      to remove.
    */
    const p = assessPreparedness({
      items: [
        { ...base, id: '1', title: 'Gmail', secret_kinds: null, factors_required: null },
        { ...base, id: '2', title: 'Bank', secret_kinds: null, factors_required: 'totp' },
        {
          ...base,
          id: '3',
          title: 'Recovered',
          secret_kinds: 'password',
          factors_required: 'totp',
          depends_on_item_id: '1',
        },
      ],
      ruledItemIds: ['1', '2', '3'],
      verifierCount: 1,
    });

    expect(p.unasked + p.undeclared + p.unresolved).toBe(3);
    expect(p.unresolved).toBe(1);
  });

  it('tells the owner the one thing that actually resolves an undeclared item', () => {
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: null, factors_required: 'totp' },
        { id: '2', title: 'Bank', ...base, secret_kinds: null, factors_required: 'totp' },
      ],
      ruledItemIds: ['1', '2'],
      verifierCount: 1,
    });

    expect(undeclaredClause(p)).toBe(
      'You said 2 of them need a code as well, and Relay cannot see whether your entry holds it — ' +
        'open each one and save it again to say.',
    );
  });

  it('says nothing about undeclared items when there are none', () => {
    const p = assessPreparedness({
      items: [{ id: '1', title: 'Gmail', ...base, secret_kinds: 'password', factors_required: '' }],
      ruledItemIds: ['1'],
      verifierCount: 1,
    });

    expect(undeclaredClause(p)).toBe('');
  });
});

describe('a vault nobody has ever declared anything in', () => {
  const base = { criticality: 'critical', is_root_credential: false, depends_on_item_id: null };

  it('is still asked, even though the sentence stays silent', () => {
    /*
      🔴 THE TENSION, PINNED ON PURPOSE, because the two rules look contradictory
      and the wrong resolution makes D3 do nothing.

      `checkingStarted` deliberately SUPPRESSES the clause until at least one
      item has been declared: telling every owner on the same afternoon that
      their finished plan is unfinished, over a measurement nobody offered them,
      is the false alarm Q1 forbids.

      The PROMPT is not that. It is the only way `checkingStarted` can ever
      become true — suppress the prompt on the same condition and checking can
      only start when an owner happens to find a control on a row, which is
      precisely the defect D3 exists to remove. A question asked of two named
      items is not the alarm the rule is about; changing the headline claim is.

      So: the sentence stays exactly as it was, and the question gets asked.
    */
    const p = assessPreparedness({
      items: [
        { id: '1', title: 'Gmail', ...base, secret_kinds: null, factors_required: null },
        { id: '2', title: 'Bank', ...base, secret_kinds: null, factors_required: null },
      ],
      ruledItemIds: ['1', '2'],
      verifierCount: 1,
    });

    expect(p.checkingStarted).toBe(false);
    expect(preparednessSentence(p, 'Sarah')).toBe(
      'If something happened tomorrow, Sarah could reach both of the things that matter.',
    );
    expect(p.unaskedItems).toEqual([
      { id: '1', title: 'Gmail' },
      { id: '2', title: 'Bank' },
    ]);
  });
});

describe('the shape of the input is itself a guard', () => {
  it('will not compile if a caller omits the columns the rule reads', () => {
    /*
      A TYPE-LEVEL TEST, and it is the one that would have caught the real
      defect. `assessReadiness` passed rows selected without the usability
      columns; they were optional, so it compiled, and the second-factor rule
      was inert on the banner from the day it shipped.

      Optional was chosen so a caller compiled against a cluster without
      migration 035 kept working — but the tolerance belongs to the VALUE, which
      may be null, not to the KEY, which the caller must think about. `null` now
      has to be written down, and forgetting the column is a build failure
      rather than a silent `unknown`.

      `@ts-expect-error` fails the typecheck if the line below ever compiles, so
      this test cannot rot into decoration.
    */
    const p = assessPreparedness({
      // @ts-expect-error — the usability columns are required, on purpose
      items: [{ id: '1', title: 'Gmail', criticality: 'critical', is_root_credential: false }],
      ruledItemIds: ['1'],
      verifierCount: 1,
    });

    expect(p.mattering).toBe(1);
  });
});
