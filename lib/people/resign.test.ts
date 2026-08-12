/**
 * Tests for leaving a circle.
 *
 * A standby account is a free user with rights, and until now they had none of
 * the obvious one: no way out. Two flows were missing entirely (sprint plan §4) —
 * resigning from a circle, and rejecting an invitation from someone you do not
 * recognise. The second is also the contact-side half of a fingerprint mismatch:
 * the control detected an interception and then offered nobody a response.
 *
 * The property that matters is that leaving DEGRADES the owner's circle rather
 * than silently shrinking it (§3.7 rule 3). Deleting the roster row would remove
 * a trusted contact from someone else's plan without telling them — the exact
 * failure this architecture exists to prevent. So the row survives, unbound and
 * red, and the owner is told.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { resignFromCircle } from './resign';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

function rows(...batches: unknown[][]) {
  for (const b of batches) mockQuery.mockResolvedValueOnce({ rows: b, rowCount: b.length } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('resignFromCircle', () => {
  it('unbinds the identity and drops the row back to invited — it does NOT delete it', async () => {
    rows([{ owner_id: 'owner-1' }]); // the guarded update

    await resignFromCircle({ userId: 'user-1', personId: 'rec-1', personType: 'recipient' });

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('UPDATE recipients');
    expect(sql).toContain('claimed_user_id = NULL');
    expect(sql).toContain("standby_state = 'invited'");
    expect(sql).not.toContain('DELETE');
  });

  it('only lets you resign from a row that is actually YOURS', async () => {
    rows([{ owner_id: 'owner-1' }]);

    await resignFromCircle({ userId: 'user-1', personId: 'rec-1', personType: 'recipient' });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('claimed_user_id = $2');
    expect(params).toContain('user-1');
  });

  it('refuses when the row is not bound to this user, changing nothing', async () => {
    rows([]); // guarded update matched nothing

    await expect(
      resignFromCircle({ userId: 'someone-else', personId: 'rec-1', personType: 'recipient' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('tells the OWNER, because it is their plan that just got weaker', async () => {
    rows([{ owner_id: 'owner-1' }]);

    await resignFromCircle({ userId: 'user-1', personId: 'rec-1', personType: 'recipient' });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ action: 'standby_resigned' }),
    );
  });

  it('works for a verifier as well as a recipient', async () => {
    rows([{ owner_id: 'owner-2' }]);

    await resignFromCircle({ userId: 'user-1', personId: 'ver-1', personType: 'verifier' });

    expect(String(mockQuery.mock.calls[0][0])).toContain('UPDATE verifiers');
  });

  it('records a rejection distinctly from a resignation', async () => {
    // "I do not know this person" is a different signal from "I am stepping
    // down", and an owner reading their audit trail needs to be able to tell
    // them apart — one of them may mean an invitation went to the wrong place.
    rows([{ owner_id: 'owner-1' }]);

    await resignFromCircle({
      userId: 'user-1',
      personId: 'rec-1',
      personType: 'recipient',
      reason: 'rejected',
    });

    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ action: 'standby_rejected' }),
    );
  });
});
