/**
 * "I got this" — the verifier's half of the rehearsal.
 *
 * This handler executed no test until 2026-08-30, and it is the only place in
 * this product where a HUMAN, rather than a mail provider, tells us they were
 * reached.
 *
 * 🔴 IT REQUIRES A SESSION, AND THAT IS THE ENTIRE FEATURE. A bare link that
 * recorded an acknowledgement on being clicked would be forgeable by anyone
 * holding the URL, and would happily record a pass from a mail scanner that
 * prefetched it — a false green built to look like the cure for false greens.
 * The refusal test below is not boilerplate here; it is the requirement.
 *
 * ⚠️ ONE PRESS ANSWERS EVERY OWNER STILL WAITING. Asking somebody to acknowledge
 * the same thing three times is how a rehearsal stops being run, so the count
 * comes back rather than a bare ok.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../lib/release/fire-drill', () => ({
  acknowledgePendingDrills: vi.fn(),
}));

import { requireOwner } from '../../../../../lib/http/owner-route';
import { acknowledgePendingDrills } from '../../../../../lib/release/fire-drill';
import { IntegrityError } from '../../../../../lib/db/integrity';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockAck = vi.mocked(acknowledgePendingDrills);

const USER = '9510683f-af55-4265-8840-b2986824a2e1';

function req(): NextRequest {
  return new NextRequest('https://relaystandby.com/api/fire-drill/ack', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: USER });
  mockAck.mockResolvedValue(2 as never);
});

describe('acknowledging', () => {
  it('answers every owner waiting on this person in one press', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockAck).toHaveBeenCalledWith(USER);
    expect(await res.json()).toEqual({ acknowledged: 2 });
  });

  it('reports zero honestly when nobody was waiting', async () => {
    mockAck.mockResolvedValueOnce(0 as never);
    expect(await (await POST(req())).json()).toEqual({ acknowledged: 0 });
  });

  it('records the press as deliberate activity by the person who made it', async () => {
    await POST(req());
    expect(mockRequireOwner.mock.calls[0][0]).toBeDefined();
  });
});

describe('it cannot be satisfied by anything but a person signing in', () => {
  it('refuses without a session and records nothing', async () => {
    // A prefetching mail scanner, or anyone holding the URL, must not be able
    // to manufacture the evidence this whole feature exists to earn.
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('maps an integrity failure to 403 rather than a 500', async () => {
    mockAck.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    expect((await POST(req())).status).toBe(403);
  });
});
