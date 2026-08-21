/**
 * When the OWNER rewrites a secret, the helper who first entered it loses it.
 *
 * 🔴 THE FALSE PROMISE THIS CLOSES, found 2026-08-21 reviewing the delegate work.
 * The consent panel a parent reads before appointing a helper says, in the
 * product's own voice, that a helper can never open or read anything the owner
 * puts in — *"Anything you enter yourself stays closed to them."*
 *
 * It was not true. `created_by_delegate_id` records who first entered an item,
 * and `POST /api/kms/unwrap` reads that column to let a delegate re-open an item
 * they created (which is reasonable: they typed it, they already know it).
 * `updateItem` rewrote `ciphertext` and `wrapped_data_key` and never touched the
 * provenance column — so after the owner changed the password on an account the
 * helper had set up for them, the helper could still unwrap it and read the NEW
 * secret, which they had never seen and were never meant to.
 *
 * That is the worst place in this product to carry a false sentence: it is on a
 * CONSENT ARTIFACT, agreed by someone who is often the vulnerable party, and the
 * people who already agreed cannot re-read it.
 *
 * THE FIX IS THE STRUCTURAL HALF, not the copy. Qualifying the sentence
 * ("...unless you change an item they entered for you") would have been honest
 * and would have left a helper holding a credential the owner had deliberately
 * rotated — which is very often exactly WHY an owner rotates one. `updateItem`
 * is owner-scoped (`WHERE id = $n AND owner_id = $n`), and `items:update` is not
 * a scope any delegate holds, so every call to it IS the owner rewriting: the
 * column can be cleared unconditionally here.
 *
 * Feature: relay-h0-mvp
 * Requirements: J3-R11 (delegate scope enforced server-side), 9.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => unknown) => fn()),
}));
vi.mock('../db/integrity', () => ({ cascadeDelete: vi.fn(async () => undefined) }));

import { query } from '../db/connection';
import { updateItem } from './vault-items';

const mockQuery = vi.mocked(query);
const B64 = Buffer.from('x'.repeat(24)).toString('base64');

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

/**
 * A full projection, because `selected()` REFUSES a row that is merely thin —
 * an absent column and a NULL column are different facts, and it will not guess.
 * Built from METADATA_COLUMNS so it cannot silently drift from the real read.
 */
const ROW: Record<string, unknown> = {
  id: 'item-1',
  type: 'login',
  title: 'Bank',
  service_name: null,
  url: null,
  category: null,
  criticality: null,
  is_root_credential: false,
  owner_set_root: null,
  recurring_billing: false,
  irreplaceable: false,
  owner_set_irreplaceable: null,
  importance_score: 0.5,
  depends_on_item_id: null,
  backup_note: null,
  secret_kinds: 'password',
  factors_required: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue(qResult([{ ...ROW }]));
});

describe('an owner rewriting a secret closes out the helper who entered it', () => {
  it('the UPDATE clears created_by_delegate_id', async () => {
    await updateItem('owner-1', 'item-1', {
      ciphertext: B64,
      wrapped_data_key: B64,
      secret_kinds: 'password',
    });

    const sql = String(mockQuery.mock.calls.at(-1)?.[0] ?? '');
    expect(
      /created_by_delegate_id\s*=\s*NULL/i.test(sql),
      'updateItem rewrote the ciphertext and left created_by_delegate_id in place, so the ' +
        'delegate who first entered the item can still unwrap the secret the owner just ' +
        'changed — while the consent panel promises the opposite.\n\nSQL was:\n' +
        sql,
    ).toBe(true);
  });

  it('it is cleared unconditionally, not COALESCEd', async () => {
    /*
      COALESCE would mean "leave it unless a caller passes something", and no
      caller passes provenance — so the guard has to be that the column is
      ASSIGNED. Same reasoning as `secret_kinds` two lines above it: the blob
      changed, so everything describing the blob changes with it.
    */
    await updateItem('owner-1', 'item-1', {
      ciphertext: B64,
      wrapped_data_key: B64,
      secret_kinds: 'password',
    });
    const sql = String(mockQuery.mock.calls.at(-1)?.[0] ?? '');
    expect(
      /COALESCE\([^)]*created_by_delegate_id/i.test(sql),
      'created_by_delegate_id is COALESCEd, which preserves the old value and defeats the fix',
    ).toBe(false);
  });
});
