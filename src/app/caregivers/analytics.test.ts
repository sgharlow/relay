/**
 * G1 WTP instrument — measurement event contract, enforced as tests.
 * Feature: relay-g1-wtp
 */
import { describe, expect, it } from 'vitest';

import { CAREGIVER_INTENT, CAREGIVER_QUALIFIED, srcFromSearch } from './analytics';

describe('G1 WTP measurement events', () => {
  it('defines distinct, stable event names for the ratio', () => {
    expect(CAREGIVER_QUALIFIED).toBe('caregiver_qualified');
    expect(CAREGIVER_INTENT).toBe('caregiver_intent');
    expect(CAREGIVER_QUALIFIED).not.toBe(CAREGIVER_INTENT);
  });

  it('reads a tagged source from the query string', () => {
    expect(srcFromSearch('?src=reddit')).toEqual({ src: 'reddit' });
    expect(srcFromSearch('?src=meta-ad&x=1')).toEqual({ src: 'meta-ad' });
  });

  it('decodes URL-encoded channel values (round-trips intentHref encoding)', () => {
    expect(srcFromSearch('?src=r%2FCaregiverSupport')).toEqual({ src: 'r/CaregiverSupport' });
  });

  it('untagged or empty src resolves to "direct" so it can be excluded from N', () => {
    expect(srcFromSearch('')).toEqual({ src: 'direct' });
    expect(srcFromSearch('?x=1')).toEqual({ src: 'direct' });
    expect(srcFromSearch('?src=')).toEqual({ src: 'direct' });
    expect(srcFromSearch('?src=%20%20')).toEqual({ src: 'direct' });
  });
});
