/**
 * Tests for /api/vault/items/[id] (PUT, DELETE)
 *
 * Validates: Requirements 1.5–1.8
 *  - not-found and cross-owner both return 403 (existence not revealed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../../../lib/db/integrity', () => {
  class IntegrityError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return { assertOwns: vi.fn(), IntegrityError };
});
vi.mock('../../../../../../lib/vault/vault-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../lib/vault/vault-items')>();
  return {
    ...actual,
    getItemForOwner: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    setItemNote: vi.fn(),
    setOwnerRootOverride: vi.fn(),
    setOwnerIrreplaceableOverride: vi.fn(),
  };
});

import { getOwnerSession } from '../../../../../../lib/auth/session';
import { assertOwns, IntegrityError } from '../../../../../../lib/db/integrity';
import { updateItem, deleteItem, setItemNote, setOwnerRootOverride, setOwnerIrreplaceableOverride } from '../../../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../../../lib/audit/audit-service';
import { PUT, DELETE, PATCH } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockAssertOwns = vi.mocked(assertOwns);
const mockUpdate = vi.mocked(updateItem);
const mockDelete = vi.mocked(deleteItem);
const mockAudit = vi.mocked(writeAuditEntry);
const mockSetNote = vi.mocked(setItemNote);
const mockSetRoot = vi.mocked(setOwnerRootOverride);
const mockSetIrreplaceable = vi.mocked(setOwnerIrreplaceableOverride);

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
function makeReq(body?: unknown) {
  return { json: async () => body } as never;
}
const VALID_B64 = 'AAAA';

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

/*
  DRIVEN THROUGH DELETE SINCE 2026-08-13, when the GET handler was retired.
  These test the shared `authorize()` helper, not any one verb — and the
  behaviour they pin is Requirement 1.8: a row you do not own and a row that
  does not exist must be indistinguishable, or the 404 itself tells an attacker
  which item IDs are real. That guarantee still has to hold on the verbs that
  remain, so the coverage moved rather than going with the handler.
*/
describe('authorization (Requirement 1.8)', () => {
  it('returns 403 — not 404 — when the row does not exist', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns 403 on a cross-owner row (same response as not-found)', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'mismatch'));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/vault/items/[id]', () => {
  it('400 on an invalid (non-base64) body', async () => {
    mockAssertOwns.mockResolvedValueOnce(undefined);
    const res = await PUT(makeReq({ ciphertext: 'bad!', wrapped_data_key: VALID_B64 }), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('replaces the payload, audits, and returns the updated metadata', async () => {
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockUpdate.mockResolvedValueOnce({ id: 'item-1', title: 'A' } as never);
    const res = await PUT(makeReq({ ciphertext: VALID_B64, wrapped_data_key: VALID_B64 }), ctx);
    expect(res.status).toBe(200);
    expect(mockAudit.mock.calls[0][1].action).toBe('vault_item_updated');
  });
});

describe('DELETE /api/vault/items/[id]', () => {
  it('cascade-deletes and audits', async () => {
    mockAssertOwns.mockResolvedValueOnce(undefined);
    mockDelete.mockResolvedValueOnce(undefined);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('owner-1', 'item-1');
    expect(mockAudit.mock.calls[0][1].action).toBe('vault_item_deleted');
  });
});

/**
 * 🔴 THE NOTE WAS ONLY AVAILABLE TO NEW ITEMS until this handler took it.
 *
 * `backup_note` reached the create form on 2026-08-17, but the only other write
 * path — PUT — demands a re-encrypted ciphertext, because that form replaces the
 * secret rather than editing it. So putting a note on something already in the
 * vault meant retyping its password, and `detectGaps` went on flagging every
 * pre-existing item with advice its owner still could not act on.
 */
describe('PATCH /api/vault/items/[id] — metadata without the secret', () => {
  it('sets a note with no ciphertext anywhere in the request', async () => {
    mockSetNote.mockResolvedValue({ id: 'item-1' } as never);
    const res = await PATCH(makeReq({ backup_note: '  Codes are in the desk drawer.  ' }), ctx);
    expect(res.status).toBe(200);
    // Trimmed at the boundary, matching create — one definition of "has a note".
    expect(mockSetNote).toHaveBeenCalledWith('owner-1', 'item-1', 'Codes are in the desk drawer.');
  });

  it('clears the note when the box is emptied', async () => {
    // ASSIGNS rather than COALESCEs, unlike PUT. An owner who wrote down where
    // something was kept and then moved it must be able to take that back.
    mockSetNote.mockResolvedValue({ id: 'item-1' } as never);
    await PATCH(makeReq({ backup_note: '   ' }), ctx);
    expect(mockSetNote).toHaveBeenCalledWith('owner-1', 'item-1', null);
  });

  it('audits that the note changed, but never what it says', async () => {
    /*
      The audit log is append-only and hash-chained. A sentence written into it
      can never be taken back — which would defeat the entire reason clearing a
      note is supported. Record that it changed and whether one now exists.
    */
    mockSetNote.mockResolvedValue({ id: 'item-1' } as never);
    await PATCH(makeReq({ backup_note: 'The spare key is under the third plant pot.' }), ctx);
    const entry = mockAudit.mock.calls[0][1];
    expect(entry.action).toBe('vault_item_note_updated');
    expect(JSON.stringify(entry.detail)).not.toContain('plant pot');
    expect(entry.detail).toMatchObject({ present: true });
  });

  it('rejects a note past the bound rather than truncating it', async () => {
    const res = await PATCH(makeReq({ backup_note: 'x'.repeat(2001) }), ctx);
    expect(res.status).toBe(400);
    expect(mockSetNote).not.toHaveBeenCalled();
  });

  it('404s on an item that is not the owner’s, without saying which', async () => {
    mockSetNote.mockResolvedValue(null as never);
    const res = await PATCH(makeReq({ backup_note: 'anything' }), ctx);
    expect(res.status).toBe(404);
  });

  it('still accepts owner_set_root exactly as before — the old contract is unchanged', async () => {
    mockSetRoot.mockResolvedValue({ id: 'item-1' } as never);
    const res = await PATCH(makeReq({ owner_set_root: true }), ctx);
    expect(res.status).toBe(200);
    expect(mockSetRoot).toHaveBeenCalledWith('owner-1', 'item-1', true);
    expect(mockAudit.mock.calls[0][1].action).toBe('vault_item_classification_overridden');
  });

  it('refuses both fields at once — each writes a different audit action', async () => {
    // An audit entry that cannot say which decision the owner made is not much
    // of an audit entry.
    const res = await PATCH(makeReq({ owner_set_root: true, backup_note: 'x' }), ctx);
    expect(res.status).toBe(400);
    expect(mockSetNote).not.toHaveBeenCalled();
    expect(mockSetRoot).not.toHaveBeenCalled();
  });

  it('refuses an empty body', async () => {
    const res = await PATCH(makeReq({}), ctx);
    expect(res.status).toBe(400);
  });
});

/**
 * 🔴 THE OWNER COULD OVERRULE THE AGENT ABOUT ROOT CREDENTIALS AND NOT ABOUT
 * WHAT IS IRREPLACEABLE — the higher-consequence of the two. `irreplaceable` is
 * what raises a CUSTODY_RISK: a deed, a will, a passport. Only the intake agent
 * ever set it, from the title alone, and an owner who knew better had no way to
 * say so. Migration 034 added owner_set_irreplaceable; this is the endpoint.
 */
describe('PATCH — the owner overrides what is irreplaceable', () => {
  it('records the override', async () => {
    mockSetIrreplaceable.mockResolvedValue({ id: 'item-1' } as never);
    const res = await PATCH(makeReq({ owner_set_irreplaceable: true }), ctx);
    expect(res.status).toBe(200);
    expect(mockSetIrreplaceable).toHaveBeenCalledWith('owner-1', 'item-1', true);
  });

  it('null hands the decision back to the agent', async () => {
    // The third state. An owner who ticks this by mistake must be able to undo
    // it, not merely flip it to false — false is itself an opinion.
    mockSetIrreplaceable.mockResolvedValue({ id: 'item-1' } as never);
    await PATCH(makeReq({ owner_set_irreplaceable: null }), ctx);
    expect(mockSetIrreplaceable).toHaveBeenCalledWith('owner-1', 'item-1', null);
  });

  it('rejects a non-boolean instead of coercing it', async () => {
    const res = await PATCH(makeReq({ owner_set_irreplaceable: 'yes' }), ctx);
    expect(res.status).toBe(400);
    expect(mockSetIrreplaceable).not.toHaveBeenCalled();
  });

  it('audits the decision', async () => {
    mockSetIrreplaceable.mockResolvedValue({ id: 'item-1' } as never);
    await PATCH(makeReq({ owner_set_irreplaceable: true }), ctx);
    expect(mockAudit.mock.calls[0][1]).toMatchObject({
      action: 'vault_item_classification_overridden',
      detail: { owner_set_irreplaceable: true },
    });
  });

  it('still takes exactly one field, now that there are three', async () => {
    /*
      The guard was `hasRoot === hasNote` — a two-field pair that would have
      silently accepted two at once the moment a third existed. Each field writes
      a different audit action, and an entry that cannot say which decision the
      owner made is not much of an audit entry.
    */
    const res = await PATCH(makeReq({ owner_set_root: true, owner_set_irreplaceable: true }), ctx);
    expect(res.status).toBe(400);
    expect(mockSetIrreplaceable).not.toHaveBeenCalled();
    expect(mockSetRoot).not.toHaveBeenCalled();
  });
});
