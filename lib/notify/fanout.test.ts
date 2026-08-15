/**
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';

import { addressesFor } from './fanout';

describe('addressesFor', () => {
  it('sends to the one address when there is only one', () => {
    expect(addressesFor({ primary: 'alex@example.net', secondary: null, carriesCredential: false })).toEqual([
      'alex@example.net',
    ]);
  });

  it('adds the second address to a message that carries no credential', () => {
    expect(
      addressesFor({
        primary: 'alex@outlook.com',
        secondary: 'alex@gmail.com',
        carriesCredential: false,
      }),
    ).toEqual(['alex@outlook.com', 'alex@gmail.com']);
  });

  /*
    🔴 THE INVARIANT THIS FILE EXISTS FOR. A second address is redundancy for a
    NOTIFICATION; for anything carrying a code, a token or a sign-in link it is
    simply a second place to intercept it. Relay's first principle is that
    nothing secret is transmitted at release time — a redundancy feature that
    quietly doubled the exposure of the messages that still do carry a
    credential would be buying reachability with the one property the product
    sells.
  */
  it('REFUSES to duplicate a message that carries a credential', () => {
    expect(
      addressesFor({
        primary: 'alex@outlook.com',
        secondary: 'alex@gmail.com',
        carriesCredential: true,
      }),
    ).toEqual(['alex@outlook.com']);
  });

  it('does not send twice when the two addresses are the same', () => {
    expect(
      addressesFor({
        primary: 'alex@example.net',
        secondary: '  ALEX@Example.net ',
        carriesCredential: false,
      }),
    ).toEqual(['alex@example.net']);
  });

  it.each(['', '   ', null, undefined])('ignores a secondary of %j', (secondary) => {
    expect(
      addressesFor({ primary: 'alex@example.net', secondary: secondary as string | null, carriesCredential: false }),
    ).toEqual(['alex@example.net']);
  });

  it('ignores a secondary that is not an address', () => {
    expect(
      addressesFor({ primary: 'alex@example.net', secondary: 'not-an-address', carriesCredential: false }),
    ).toEqual(['alex@example.net']);
  });

  /*
    THE BOUND. `lib/ops/outbound-mail-bounds.test.ts` holds the property that
    every way an authenticated caller can make Relay send mail is bounded, and
    this feature multiplies the mail one account generates. Two is the whole
    point and two is the ceiling: a third channel is a product decision with its
    own budget conversation, not something a later edit should be able to add by
    appending to a list.
  */
  it('never returns more than two addresses', () => {
    const out = addressesFor({
      primary: 'alex@outlook.com',
      secondary: 'alex@gmail.com',
      carriesCredential: false,
    });
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
