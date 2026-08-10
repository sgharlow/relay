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
    ({ reachable: 3, mattering: 5, unreachable: [], gaps: [], ready: false, ...over });

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
    expect(missingClause({ reachable: 2, mattering: 2, unreachable: [], gaps: [], ready: true })).toBe('');
  });

  it('reads as a sentence, not a list dump', () => {
    expect(
      missingClause({
        reachable: 3,
        mattering: 5,
        unreachable: ['the phone carrier PIN'],
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
