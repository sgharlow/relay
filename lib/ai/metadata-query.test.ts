/**
 * Tests for lib/ai/metadata-query.ts
 *
 * Validates: Requirement 11.5 (ZK boundary — never selects secret columns)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { getVaultMetadata } from './metadata-query';

const mockQuery = vi.mocked(query);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('getVaultMetadata', () => {
  it('never selects ciphertext / wrapped_data_key / kms_key_id', async () => {
    mockQuery.mockResolvedValueOnce(qResult([]));
    await getVaultMetadata('owner-1');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('ciphertext');
    expect(sql).not.toContain('wrapped_data_key');
    expect(sql).not.toContain('kms_key_id');
  });

  it('maps rows to typed metadata (importance_score as number, flags as boolean)', async () => {
    mockQuery.mockResolvedValueOnce(
      qResult([
        { id: 'a', title: 'Gmail', service_name: 'Google', url: null, category: 'communication', type: 'login', criticality: 'critical', is_root_credential: true, recurring_billing: false, irreplaceable: false, importance_score: '0.950', depends_on_item_id: null, backup_note: null },
      ]),
    );
    const [item] = await getVaultMetadata('owner-1');
    expect(item.importance_score).toBe(0.95);
    expect(item.is_root_credential).toBe(true);
  });
});
