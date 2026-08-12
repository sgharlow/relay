/**
 * Tests for adaptive minting — who gets a live credential in their email.
 *
 * Every case here is a decision about putting a working secret into a channel
 * we do not control, so each one is asserted on its own rather than through a
 * table: when one of these regresses, the test name should say what got mailed
 * to whom.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R2, J7-R5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { classifyVerifiersForNotice, classifyOrFailOpen } from './verifier-notice-class';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  // `clearAllMocks` alone leaves queued `…Once` implementations in place, so a
  // test that seeds three responses and makes one call poisons the next test
  // with the leftovers. Reset, then re-establish the blanket.
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

/**
 * Wires the three lookups the classifier makes: the roster, then passkeys and
 * authenticators in parallel.
 */
function seed(
  verifiers: { id: string; standby_state: string | null; claimed_user_id: string | null }[],
  opts: { passkeyUsers?: string[]; totpUsers?: string[] } = {},
) {
  mockQuery
    .mockResolvedValueOnce({ rows: verifiers, rowCount: verifiers.length } as never)
    .mockResolvedValueOnce({
      rows: (opts.passkeyUsers ?? []).map((user_id) => ({ user_id })),
    } as never)
    .mockResolvedValueOnce({ rows: (opts.totpUsers ?? []).map((id) => ({ id })) } as never);
}

describe('classifyVerifiersForNotice', () => {
  it('mints for a confirmed verifier with no way to sign in', async () => {
    seed([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }]);
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(new Map([['v1', 'code']]));
  });

  it('does NOT mint for a confirmed verifier who holds a passkey', async () => {
    seed([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }], { passkeyUsers: ['u1'] });
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(new Map([['v1', 'sign_in']]));
  });

  it('does NOT mint for a verifier who is also an owner with an authenticator', async () => {
    // §3.7 rule 2 links a second relationship onto an existing account rather
    // than minting a new one, so this person signs in with email + TOTP and has
    // never needed a passkey. Keying on passkeys alone would mail a live code to
    // the one class of person who most obviously already has a way in.
    seed([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }], { totpUsers: ['u1'] });
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(new Map([['v1', 'sign_in']]));
  });

  it('does NOT mint for a CLAIMED but unconfirmed verifier — their answer would not count', async () => {
    // The obvious mirror of the recipient branch is `claimed`, and it is wrong
    // in both directions: claiming does not make an answer count, and being
    // confirmed is what does.
    seed([{ id: 'v1', standby_state: 'claimed', claimed_user_id: 'u1' }]);
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(
      new Map([['v1', 'not_counted']]),
    );
  });

  it('does NOT mint for an invited verifier who never claimed', async () => {
    seed([{ id: 'v1', standby_state: 'invited', claimed_user_id: null }]);
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(
      new Map([['v1', 'not_counted']]),
    );
  });

  it('treats a NULL standby_state as not counting, never as confirmed', async () => {
    seed([{ id: 'v1', standby_state: null, claimed_user_id: null }]);
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(
      new Map([['v1', 'not_counted']]),
    );
  });

  it('sends a revoked verifier nothing at all', async () => {
    seed([{ id: 'v1', standby_state: 'revoked', claimed_user_id: 'u1' }], { passkeyUsers: ['u1'] });
    await expect(classifyVerifiersForNotice(['v1'])).resolves.toEqual(new Map([['v1', 'skip']]));
  });

  it('classifies a mixed circle independently, person by person', async () => {
    seed(
      [
        { id: 'v-signin', standby_state: 'confirmed', claimed_user_id: 'u1' },
        { id: 'v-code', standby_state: 'confirmed', claimed_user_id: 'u2' },
        { id: 'v-unclaimed', standby_state: 'invited', claimed_user_id: null },
        { id: 'v-gone', standby_state: 'revoked', claimed_user_id: 'u3' },
      ],
      { passkeyUsers: ['u1'] },
    );

    await expect(
      classifyVerifiersForNotice(['v-signin', 'v-code', 'v-unclaimed', 'v-gone']),
    ).resolves.toEqual(
      new Map([
        ['v-signin', 'sign_in'],
        ['v-code', 'code'],
        ['v-unclaimed', 'not_counted'],
        ['v-gone', 'skip'],
      ]),
    );
  });

  it('touches the database not at all for an empty circle', async () => {
    await expect(classifyVerifiersForNotice([])).resolves.toEqual(new Map());
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('skips the credential lookups when nobody has claimed', async () => {
    seed([{ id: 'v1', standby_state: 'invited', claimed_user_id: null }]);
    await classifyVerifiersForNotice(['v1']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('an unredeemed break-glass code does NOT suppress the mail', () => {
  it('never reads break_glass_codes', async () => {
    // `lib/vault/readiness.ts` counts one as a way back in, and for its question
    // — did the owner leave this person a fallback — that is right. Here the
    // question is whether they can act in the next hour, and an issued code that
    // is lost is indistinguishable in the database from one held in a wallet.
    seed([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }]);
    await classifyVerifiersForNotice(['v1']);

    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toMatch(/break_glass/i);
    }
  });
});

describe('classifyOrFailOpen', () => {
  it('returns an empty map on a lookup failure, so callers mint for everyone', async () => {
    // Deliberate direction. Failing the other way would leave a confirmed
    // verifier with no passkey unable to answer at all, stalling a real release;
    // failing this way costs one unnecessary code to somebody who could also
    // have signed in, and the runtime quorum gate still refuses to count an
    // answer from anyone unconfirmed.
    mockQuery.mockRejectedValueOnce(new Error('DSQL unavailable') as never);
    await expect(classifyOrFailOpen(['v1'])).resolves.toEqual(new Map());
  });

  it('passes a successful classification straight through', async () => {
    seed([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }], { passkeyUsers: ['u1'] });
    await expect(classifyOrFailOpen(['v1'])).resolves.toEqual(new Map([['v1', 'sign_in']]));
  });
});
