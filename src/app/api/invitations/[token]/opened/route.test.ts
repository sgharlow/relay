/**
 * The middle of the Phase 0 funnel — the claim page loaded with this code.
 *
 * This handler executed no test until 2026-08-30. Without this route "never
 * arrived" and "arrived and abandoned" are the same number, and they are
 * different problems with different fixes.
 *
 * 🔴 IT ALWAYS ANSWERS 204, WHETHER OR NOT THE CODE EXISTS. Answering
 * differently would turn a measurement endpoint into an oracle for guessing
 * invitation codes — on an unauthenticated route, where an invitation code is
 * the entire credential for claiming a place in somebody's vault. The
 * unknown-code case is asserted explicitly rather than assumed.
 *
 * Feature: relay-standby
 * Requirements: J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../../lib/people/invitations', () => ({
  markInvitationOpened: vi.fn(async () => undefined),
}));

import { markInvitationOpened } from '../../../../../../lib/people/invitations';
import { POST } from './route';

const mockMark = vi.mocked(markInvitationOpened);
const TOKEN = 'inv_5t7cptqn9wke';

function req(): NextRequest {
  return new NextRequest('https://relaystandby.com/api/invitations/' + TOKEN + '/opened', {
    method: 'POST',
  });
}
const ctx = { params: Promise.resolve({ token: TOKEN }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockMark.mockResolvedValue(undefined as never);
});

describe('recording that the page was opened', () => {
  it('marks the token from the path', async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(204);
    expect(mockMark).toHaveBeenCalledWith(TOKEN);
  });

  it('returns an empty body, because the browser does nothing with it', async () => {
    expect(await (await POST(req(), ctx)).text()).toBe('');
  });

  it('answers 204 for a code that does not exist', async () => {
    // The property that keeps this from being a guessing oracle: an unknown
    // token is indistinguishable from a real one.
    mockMark.mockResolvedValueOnce(undefined as never);
    const unknown = { params: Promise.resolve({ token: 'inv_guessed' }) };
    const res = await POST(req(), unknown);
    expect(res.status).toBe(204);
    expect(mockMark).toHaveBeenCalledWith('inv_guessed');
  });
});
