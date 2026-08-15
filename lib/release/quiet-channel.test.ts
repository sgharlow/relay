/**
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';

import {
  isVerifierSilence,
  whoToRing,
  callListLines,
  VERIFIER_SILENCE_WINDOW_MS,
} from './quiet-channel';

const now = new Date('2026-08-14T18:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const overWindow = () => new Date(now.getTime() - VERIFIER_SILENCE_WINDOW_MS - 60_000).toISOString();

const waiting = {
  state: 'pending',
  initiated_at: overWindow(),
  received_confirmations: 0,
  required_confirmations: 2,
};

describe('isVerifierSilence', () => {
  it('fires when a release has waited past the window with quorum unmet', () => {
    expect(isVerifierSilence(waiting, now)).toBe(true);
  });

  it('fires in grace too — the window is open and nobody is answering', () => {
    expect(isVerifierSilence({ ...waiting, state: 'grace' }, now)).toBe(true);
  });

  it('does not fire while quorum is already satisfied', () => {
    expect(isVerifierSilence({ ...waiting, received_confirmations: 2 }, now)).toBe(false);
  });

  it('does not fire before the window has elapsed', () => {
    expect(isVerifierSilence({ ...waiting, initiated_at: hoursAgo(1) }, now)).toBe(false);
  });

  it.each(['armed', 'released'])('does not fire in %s — nothing is waiting', (state) => {
    expect(isVerifierSilence({ ...waiting, state }, now)).toBe(false);
  });

  /*
    Same rule as isChallengeLapsed: BAD DATA MUST NEVER TRIGGER ANYTHING. An
    unparseable or missing timestamp reads as "we do not know how long", and
    "we do not know" is not grounds for telling a family their circle has gone
    silent.
  */
  it.each([null, '', 'not-a-date'])('does not fire on an initiated_at of %j', (v) => {
    expect(isVerifierSilence({ ...waiting, initiated_at: v }, now)).toBe(false);
  });

  it('does not fire when no confirmations are required at all', () => {
    expect(isVerifierSilence({ ...waiting, required_confirmations: 0 }, now)).toBe(false);
  });
});

describe('whoToRing', () => {
  const lee = { id: 'v1', name: 'Lee', phone: '+1 555 0100', answered: false, revoked: false };
  const sam = { id: 'v2', name: 'Sam', phone: null, answered: false, revoked: false };

  it('names only the people who have not answered', () => {
    const out = whoToRing([lee, { ...sam, answered: true }]);
    expect(out.map((p) => p.name)).toEqual(['Lee']);
  });

  /*
    A revoked verifier was removed by the owner on purpose. `notifyOneVerifier`
    already refuses to mail them — telling a family "ring this person, they have
    not answered" would leak the same fact down a channel with no guard on it.
  */
  it('never names somebody the owner revoked', () => {
    expect(whoToRing([{ ...lee, revoked: true }, sam]).map((p) => p.name)).toEqual(['Sam']);
  });

  it('puts the people who can actually be rung first', () => {
    expect(whoToRing([sam, lee]).map((p) => p.name)).toEqual(['Lee', 'Sam']);
  });

  it('is empty when everybody has answered', () => {
    expect(whoToRing([{ ...lee, answered: true }, { ...sam, answered: true }])).toEqual([]);
  });
});

describe('callListLines', () => {
  it('gives the number when there is one', () => {
    const [line] = callListLines([
      { id: 'v1', name: 'Lee', phone: '+1 555 0100', answered: false, revoked: false },
    ]);
    expect(line).toContain('Lee');
    expect(line).toContain('+1 555 0100');
  });

  /*
    A missing number is the actionable half of this message, not a blank to be
    hidden. It tells whoever is reading which person they have to find another
    way to reach — and it tells the owner, afterwards, which row to fix.
  */
  it('says so plainly when there is no number, rather than leaving a gap', () => {
    const [line] = callListLines([
      { id: 'v2', name: 'Sam', phone: null, answered: false, revoked: false },
    ]);
    expect(line).toContain('Sam');
    expect(line.toLowerCase()).toContain('no phone number');
  });

  it('never emits a line for somebody who answered', () => {
    expect(
      callListLines([{ id: 'v1', name: 'Lee', phone: '555', answered: true, revoked: false }]),
    ).toEqual([]);
  });
});
