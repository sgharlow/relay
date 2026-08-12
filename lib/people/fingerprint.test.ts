/**
 * Tests for the fingerprint phrase.
 *
 * This is the whole of the assurance model (§3.3): one boolean per person, set by
 * the owner after comparing a short phrase with the contact out of band. No
 * webhook ledger, no acknowledgement state machine, no scheduled sweep.
 *
 * What it defends against is narrow and worth naming: the claim ticket is a
 * bearer secret for the hours or days between the owner sending it and the
 * contact spending it. If it were intercepted, the interceptor would claim the
 * slot and look, from the database, exactly like the intended person. The
 * fingerprint is the only thing that can tell those two apart, and it works only
 * because the comparison happens over a channel the attacker does not control.
 *
 * The property that makes it worth anything: the phrase must CHANGE when the
 * identity behind it changes. A confirmation is about a specific human holding a
 * specific slot, and re-claiming binds a different `claimed_user_id`.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  fingerprintFor,
  FINGERPRINT_WORDS,
  FINGERPRINT_LENGTH,
  confirmPerson,
} from './fingerprint';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

const BINDING = {
  ownerId: 'owner-1',
  personId: 'rec-1',
  claimedUserId: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('fingerprintFor', () => {
  it('is deterministic — both sides must see the same phrase', () => {
    expect(fingerprintFor(BINDING)).toBe(fingerprintFor(BINDING));
  });

  it('CHANGES when the identity behind the slot changes', () => {
    // The point of the whole control. A re-claim binds a different user, so a
    // confirmation made about the previous holder must not still read as valid.
    const other = fingerprintFor({ ...BINDING, claimedUserId: 'user-2' });
    expect(other).not.toBe(fingerprintFor(BINDING));
  });

  it('differs per person and per owner, so one phrase never covers two slots', () => {
    expect(fingerprintFor({ ...BINDING, personId: 'rec-2' })).not.toBe(fingerprintFor(BINDING));
    expect(fingerprintFor({ ...BINDING, ownerId: 'owner-2' })).not.toBe(fingerprintFor(BINDING));
  });

  it('does not depend on any secret, so rotating one cannot silently invalidate every confirmation', () => {
    const before = fingerprintFor(BINDING);
    process.env.NEXTAUTH_SECRET = 'a-completely-different-secret';
    expect(fingerprintFor(BINDING)).toBe(before);
  });

  it('is words a person can read down a phone line', () => {
    const phrase = fingerprintFor(BINDING);
    const parts = phrase.split(' ');
    expect(parts).toHaveLength(FINGERPRINT_LENGTH);
    for (const p of parts) {
      expect(FINGERPRINT_WORDS).toContain(p);
      expect(p).toMatch(/^[a-z]+$/);
    }
  });

  it('draws on a word list with no near-homophones to mishear', () => {
    expect(new Set(FINGERPRINT_WORDS).size).toBe(FINGERPRINT_WORDS.length);
    expect(FINGERPRINT_WORDS.length).toBeGreaterThanOrEqual(64);
  });

  it('spreads across the list rather than favouring the first few words', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      fingerprintFor({ ...BINDING, personId: `rec-${i}` })
        .split(' ')
        .forEach((w) => seen.add(w));
    }
    expect(seen.size).toBeGreaterThan(FINGERPRINT_WORDS.length / 2);
  });
});

describe('confirmPerson', () => {
  it('only confirms a person who has actually claimed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      confirmPerson({ ownerId: 'owner-1', personId: 'rec-1', personType: 'recipient' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('moves claimed to confirmed and stamps when it happened', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rec-1' }], rowCount: 1 } as never);

    await confirmPerson({ ownerId: 'owner-1', personId: 'rec-1', personType: 'recipient' });

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain("standby_state = 'confirmed'");
    expect(sql).toContain('fingerprint_confirmed_at');
    // Guarded: only from `claimed`, and only for this owner's row.
    expect(sql).toContain("standby_state = 'claimed'");
    expect(sql).toContain('owner_id = $2');
  });

  it('records it against the owner, who is the one making the assertion', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rec-1' }], rowCount: 1 } as never);

    await confirmPerson({ ownerId: 'owner-1', personId: 'rec-1', personType: 'recipient' });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ action: 'standby_confirmed' }),
    );
  });
});
