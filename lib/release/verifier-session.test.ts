/**
 * Tests for verifier resolution from a session.
 *
 * THE GAP, which was in the plan before it was in the code: `standby-architecture.md`
 * §3.2 described the release-path swap in recipient vocabulary and §6 Phase 2 said
 * "claimed *recipients* stop receiving codes", so Sprint D swapped the recipient
 * and left the verifier on tokens — while §3.1 gave standby verifiers an auth
 * method and §4.4 rested derive-on-read on a verifier acting from their dashboard.
 * Escalation ran on dashboard load and stranded the person it had made
 * responsible. Core principle 5 was false for claimed verifiers.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R5, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { resolveVerifierFor } from './verifier-session';

const mockQuery = vi.mocked(query);

const USER = '11111111-1111-4111-8111-111111111111';
const VERIFIER = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const RELEASE = '44444444-4444-4444-8444-444444444444';

function row(state = 'pending') {
  return {
    verifier_id: VERIFIER,
    owner_id: OWNER,
    release_state_id: RELEASE,
    state,
  };
}

/** The SQL text of the call, whitespace-collapsed. */
function sql(): string {
  return String(mockQuery.mock.calls[0][0]).replace(/\s+/g, ' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('resolveVerifierFor', () => {
  it('resolves the roster row and the open release for a signed-in verifier', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()], rowCount: 1 } as never);

    await expect(resolveVerifierFor(USER)).resolves.toEqual({
      verifierId: VERIFIER,
      ownerId: OWNER,
      releaseStateId: RELEASE,
      state: 'pending',
    });
  });

  it('returns null — not an error — for someone with nothing to decide', async () => {
    // The normal case for an owner, a recipient, or a verifier in quiet times.
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(resolveVerifierFor(USER)).resolves.toBeNull();
  });

  it('reads membership from the DATABASE, keyed on claimed_user_id (§3.7 rule 1)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()], rowCount: 1 } as never);
    await resolveVerifierFor(USER);

    expect(sql()).toContain('claimed_user_id = $1');
    expect(mockQuery.mock.calls[0][1]).toEqual([USER, null]);
  });

  it('excludes a revoked verifier — revocation is the control behind the coercion risk', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await resolveVerifierFor(USER);
    expect(sql()).toContain("<> 'revoked'");
  });

  it('offers a decision only in pending or grace, matching submitConfirmation', async () => {
    // Any other state is not a question anyone is being asked, and the server
    // would refuse it — so the dashboard must never present the button.
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await resolveVerifierFor(USER);
    expect(sql()).toContain("rs.state IN ('pending', 'grace')");
  });

  it('prefers pending over grace when one person covers two owners at once', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()], rowCount: 1 } as never);
    await resolveVerifierFor(USER);
    expect(sql()).toContain("CASE rs.state WHEN 'pending' THEN 0 ELSE 1 END");
  });

  it('narrows to a specific release when the dashboard names one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row('grace')], rowCount: 1 } as never);

    const out = await resolveVerifierFor(USER, { releaseStateId: RELEASE });

    expect(mockQuery.mock.calls[0][1]).toEqual([USER, RELEASE]);
    expect(out?.state).toBe('grace');
  });

  it('still filters on the roster row when a release id is supplied', async () => {
    // The id narrows WHICH release; it never substitutes for authorization. A
    // caller naming someone else's release gets no row back.
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(
      resolveVerifierFor(USER, { releaseStateId: 'someone-elses' }),
    ).resolves.toBeNull();
    expect(sql()).toContain('claimed_user_id = $1');
  });
});
