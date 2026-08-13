/**
 * Tests for what a helper can see.
 *
 * The load-bearing assertions are NEGATIVE. A helper reads back only what they
 * personally entered (J3-R4), and a delegation with no recorded consent is not a
 * workspace (J3-R2) — both enforced in SQL rather than by the caller passing the
 * right thing.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { listVaultsIHelp, listItemsIEntered, listMyPendingProposals } from './delegate-workspace';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('listVaultsIHelp', () => {
  it('names the owner by display name, falling back to their address', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'd-1', owner_id: 'o-1', scopes: ['items:create'], display_name: 'Margaret Chen', email: 'm@example.com' },
        { id: 'd-2', owner_id: 'o-2', scopes: [], display_name: null, email: 'pat@example.com' },
      ],
    } as never);

    const out = await listVaultsIHelp('u-1');
    expect(out.map((v) => v.ownerLabel)).toEqual(['Margaret Chen', 'pat@example.com']);
  });

  it('EXCLUDES a delegation with no recorded consent', async () => {
    // A pending delegation grants nothing (J3-R2). Showing it as a workspace
    // would invite somebody to start working somewhere they cannot write.
    await listVaultsIHelp('u-1');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/status\s*=\s*'active'/);
    expect(sql).toMatch(/revoked_at IS NULL/);
  });

  it('is scoped to the acting user, never to an owner', async () => {
    await listVaultsIHelp('u-1');
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/delegate_user_id = \$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1']);
  });

  it('survives a null scopes column rather than throwing at render time', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'd-1', owner_id: 'o-1', scopes: null, display_name: 'X', email: 'x@example.com' }],
    } as never);
    await expect(listVaultsIHelp('u-1')).resolves.toEqual([
      { ownerId: 'o-1', ownerLabel: 'X', delegationId: 'd-1', scopes: [] },
    ]);
  });
});

describe('listItemsIEntered', () => {
  it('🔴 filters on BOTH the owner and the delegation', async () => {
    // Either alone is a bug of a different shape: owner alone shows a helper the
    // entire vault; delegation alone would cross vaults if an id were reused.
    await listItemsIEntered('o-1', 'd-1');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/owner_id = \$1/);
    expect(sql).toMatch(/created_by_delegate_id = \$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['o-1', 'd-1']);
  });

  it('NEVER selects ciphertext or the wrapped key', async () => {
    // A helper may not read what they entered — only see that it is there.
    await listItemsIEntered('o-1', 'd-1');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).not.toMatch(/ciphertext|wrapped_data_key|kms_key_id/);
  });
});

describe('listMyPendingProposals', () => {
  it('shows only this delegation own pending proposals', async () => {
    await listMyPendingProposals('o-1', 'd-1');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/proposed_by_delegation_id = \$2/);
    expect(sql).toMatch(/status\s*=\s*'pending'/);
  });
});
