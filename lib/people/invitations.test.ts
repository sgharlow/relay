/**
 * Tests for invitations and the recipient standby view.
 *
 * Today a recipient's first contact with Relay is a raw `?token=` URL arriving
 * at the worst moment of their life. Claiming moves to designation time, in
 * calm (J4-R9).
 *
 * The standby view discloses the SHAPE of a grant — counts and categories —
 * never item titles, never content (J4-R10).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  createInvitation,
  redeemInvitation,
  buildStandbyView,
  hashToken,
  INVITE_TTL_DAYS,
} from './invitations';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('hashToken', () => {
  it('is deterministic and not the token itself', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('createInvitation', () => {
  it('stores only the HASH of the token, never the token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv-1' }] } as never);

    const out = await createInvitation('o-1', { personId: 'r-1', personType: 'recipient' });

    // calls[0] retires any earlier live code for this person; calls[1] inserts.
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO invitations/i.test(String(c[0])));
    expect(insert, 'no INSERT was issued').toBeDefined();
    const params = insert![1] as unknown[];
    expect(params).toContain(hashToken(out.token));
    expect(params).not.toContain(out.token);
  });

  it('returns a high-entropy token and an expiry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv-1' }] } as never);

    const out = await createInvitation('o-1', { personId: 'r-1', personType: 'recipient' });

    // A TYPED code now, not a 32-byte URL token: every credential Relay emails
    // is typed, because "we never send a link that signs you in" is only usable
    // for spotting a fake if it holds for all of our mail. Ten characters over
    // the 31-character unambiguous alphabet is ~50 bits — deliberately longer
    // than the 8-character verifier and recipient codes, because an invitation
    // lives 30 days rather than 24-72 hours.
    expect(out.token).toHaveLength(10);
    expect(out.token).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTVWXYZ]+$/);
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unknown person type', async () => {
    await expect(
      createInvitation('o-1', { personId: 'r-1', personType: 'stranger' as never }),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('expires in a usable window', () => {
    expect(INVITE_TTL_DAYS).toBeGreaterThanOrEqual(7);
  });

  it('retires this person\'s earlier unclaimed codes before minting a new one', async () => {
    /*
      🔴 EVERY REISSUE USED TO ADD A LIVE CODE RATHER THAN REPLACE ONE.
      `createInvitation` INSERTed unconditionally and nothing anywhere retired a
      prior row — the only `UPDATE invitations SET claimed_at` outside redemption
      is the rejection path in fingerprint.ts. Redemption matches on `token_hash`
      with `claimed_at IS NULL AND expires_at > now()`, so an owner who pressed
      Invite three times left THREE independently redeemable credentials for one
      seat, each good for thirty days, and had no way to withdraw the first two.

      It also minted a row nobody could ever type. `inviteOnCreateBestEffort`
      discards the code it gets back, and on the owner-delivered arm nothing is
      sent — only the hash is stored — so creating a person left one permanently
      unredeemable invitation, which Phase 0 then counted as issued.

      Retired by EXPIRY, not DELETE, so Phase 0 keeps the funnel record
      (delivery_channel, cohort, created_at) it needs to interpret the arms.
    */
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await createInvitation('o-1', { personId: 'r-1', personType: 'recipient' });

    const [retire, retireParams] = mockQuery.mock.calls[0];
    expect(String(retire)).toMatch(/UPDATE invitations/i);
    expect(String(retire)).toMatch(/expires_at = now\(\)/i);
    expect(String(retire)).toMatch(/claimed_at IS NULL/i);
    expect(retireParams).toEqual(['o-1', 'r-1']);

    // …and only then the new one.
    expect(String(mockQuery.mock.calls[1][0])).toMatch(/INSERT INTO invitations/i);
  });

  it('retires only THIS person\'s codes, scoped to the owner', async () => {
    // A retirement keyed on person_id alone would be correct today (person ids
    // are UUIDs) and wrong the moment anything reuses one. Scope it.
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await createInvitation('o-1', { personId: 'r-1', personType: 'recipient' });
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/owner_id = \$1[\s\S]*person_id = \$2/i);
  });
});

describe('redeemInvitation', () => {
  it('looks up by token HASH, marks claimed, and returns the person', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'inv-1', owner_id: 'o-1', person_id: 'r-1', person_type: 'recipient' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(redeemInvitation('tok')).resolves.toEqual({
      ownerId: 'o-1',
      personId: 'r-1',
      personType: 'recipient',
    });

    expect(mockQuery.mock.calls[0][1]).toContain(hashToken('tok'));
    expect(mockQuery.mock.calls[1][0] as string).toMatch(/claimed_at/i);
  });

  it('rejects an unknown, expired, or already-claimed token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(redeemInvitation('nope')).rejects.toThrow(ValidationError);
  });

  it('filters expired and claimed rows in SQL, not in JS', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await redeemInvitation('nope').catch(() => undefined);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/claimed_at IS NULL/i);
    expect(sql).toMatch(/expires_at\s*>\s*now\(\)/i);
  });
});

describe('buildStandbyView', () => {
  it('returns counts and categories only', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { category: 'finance', trigger_type: 'emergency', n: '2' },
        { category: 'health', trigger_type: 'emergency', n: '1' },
      ],
    } as never);

    const v = await buildStandbyView('o-1', 'r-1');

    expect(v.itemCount).toBe(3);
    expect(v.categories).toEqual({ finance: 2, health: 1 });
    expect(v.triggerTypes).toEqual(['emergency']);
  });

  it('NEVER selects title or ciphertext columns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await buildStandbyView('o-1', 'r-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/\btitle\b/i);
    expect(sql).not.toMatch(/ciphertext|wrapped_data_key|kms_key_id/i);
    expect(sql).toMatch(/owner_id\s*=\s*\$/);
  });

  it('leaks no titles into the serialised payload', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ category: 'finance', trigger_type: 'emergency', n: '2' }],
    } as never);

    const v = await buildStandbyView('o-1', 'r-1');
    expect(JSON.stringify(v)).not.toMatch(/title|ciphertext|wrapped/i);
  });

  it('handles a recipient with no grants', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const v = await buildStandbyView('o-1', 'r-1');
    expect(v.itemCount).toBe(0);
    expect(v.categories).toEqual({});
    expect(v.triggerTypes).toEqual([]);
  });

  it('deduplicates trigger types across categories', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { category: 'finance', trigger_type: 'emergency', n: '1' },
        { category: 'health', trigger_type: 'emergency', n: '1' },
        { category: 'health', trigger_type: 'estate', n: '1' },
      ],
    } as never);

    expect((await buildStandbyView('o-1', 'r-1')).triggerTypes).toEqual(['emergency', 'estate']);
  });
});
