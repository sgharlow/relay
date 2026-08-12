/**
 * Tests for issuing an invitation.
 *
 * THE POINT OF THIS FILE IS THE RETURNED CODE. `inviteAndNotify` computed the
 * readable code, put it in an email, and dropped it — so the owner never saw it.
 * That left the entire standby architecture depending on the one channel it was
 * reorganised around NOT trusting: delivery was measured broken on 2026-08-11
 * (Outlook filing at SCL 5, Resend suppression returning 200 for a muted
 * recipient). Only a hash is persisted, so if the code is not returned here it
 * is unrecoverable and the owner's only option is to reissue.
 *
 * Reading it down the phone is also better assurance than an inbox: a voice the
 * person recognises binds identity in a way a forwarded email cannot.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./invitations', () => ({
  createInvitation: vi.fn(async () => ({ token: 'ABCDEFGHJK', expiresAt: '2026-09-11T00:00:00Z' })),
  formatInviteCode: (t: string) => `${t.slice(0, 5)}-${t.slice(5)}`,
}));
vi.mock('../notify/notifications', () => ({ notifyInvitation: vi.fn(async () => true) }));
vi.mock('./owner-label', () => ({ getOwnerLabel: vi.fn(async () => 'Margaret') }));

import { query } from '../db/connection';
import { notifyInvitation } from '../notify/notifications';
import { createInvitation } from './invitations';
import { inviteAndNotify } from './invite';

const mockQuery = vi.mocked(query);
const mockNotify = vi.mocked(notifyInvitation);

const OWNER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset().mockResolvedValue({
    rows: [{ name: 'Dana', email: 'dana@example.com' }],
    rowCount: 1,
  } as never);
  mockNotify.mockReset().mockResolvedValue(true);
});

describe('inviteAndNotify', () => {
  it('returns the readable code so the owner can read it down the phone', async () => {
    const res = await inviteAndNotify(OWNER, PERSON, 'recipient');
    expect(res.claimCode).toBe('ABCDE-FGHJK');
  });

  it('returns the same code it emailed — one code, not two', async () => {
    const res = await inviteAndNotify(OWNER, PERSON, 'recipient');
    const emailed = mockNotify.mock.calls[0][0] as { claimCode: string };
    expect(res.claimCode).toBe(emailed.claimCode);
  });

  it('keeps the credential out of the claim URL', async () => {
    // A forwarded invitation must grant nothing, which is what lets Relay say it
    // never sends a link that signs anyone in.
    const res = await inviteAndNotify(OWNER, PERSON, 'recipient');
    expect(res.claimUrl).not.toContain('ABCDE');
    expect(res.claimUrl.endsWith('/claim')).toBe(true);
  });

  it('still returns the code when the email bounces — that is when it matters most', async () => {
    mockNotify.mockResolvedValueOnce(false);

    const res = await inviteAndNotify(OWNER, PERSON, 'recipient');

    expect(res.emailDelivered).toBe(false);
    expect(res.claimCode).toBe('ABCDE-FGHJK');
  });

  it('reports undelivered rather than throwing when the person has no row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const res = await inviteAndNotify(OWNER, PERSON, 'verifier');

    expect(res.emailDelivered).toBe(false);
    expect(res.claimCode).toBe('ABCDE-FGHJK');
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('Phase 0 — the delivery split', () => {
  it('records the arm on the invitation, or nothing can be attributed', async () => {
    // Every invitation the PRODUCT issued carried no channel until 2026-08-12,
    // so all real traffic landed in the report's "unknown" bucket and the split
    // that de-confounds the whole measurement never happened.
    await inviteAndNotify(OWNER, PERSON, 'recipient', 'owner');

    expect(vi.mocked(createInvitation)).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ deliveryChannel: 'owner' }),
    );
  });

  it('does NOT email on the owner-delivered arm', async () => {
    // Sending it "as a backup" would put the code in both channels at once:
    // every invitation would belong to both arms and neither number would mean
    // anything. It would also mail a live credential the owner is about to
    // speak aloud, through the channel measured broken on 2026-08-11.
    const res = await inviteAndNotify(OWNER, PERSON, 'recipient', 'owner');

    expect(mockNotify).not.toHaveBeenCalled();
    expect(res.emailDelivered).toBe(false);
    // They still get the code — that is the whole point of this arm.
    expect(res.claimCode).toBe('ABCDE-FGHJK');
  });

  it('still emails on the email arm', async () => {
    const res = await inviteAndNotify(OWNER, PERSON, 'recipient', 'email');

    expect(mockNotify).toHaveBeenCalled();
    expect(res.emailDelivered).toBe(true);
  });

  it('defaults to email, so every pre-existing caller is unchanged', async () => {
    await inviteAndNotify(OWNER, PERSON, 'recipient');
    expect(mockNotify).toHaveBeenCalled();
  });
});
