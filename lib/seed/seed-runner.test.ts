/**
 * Tests for lib/seed/seed-runner.ts
 *
 * Validates: Requirement 11.1 (seed inserts the dataset correctly)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../release/provisioning', () => ({ ensureReleaseState: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { ensureReleaseState } from '../release/provisioning';
import { seedDemo } from './seed-runner';

const mockQuery = vi.mocked(query);
const mockEnsure = vi.mocked(ensureReleaseState);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  // Every INSERT ... RETURNING id hands back a fresh fake id.
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('RETURNING id')) return qResult([{ id: `id-${n++}` }]);
    return qResult([]);
  });
});

describe('seedDemo', () => {
  it('inserts the owner, 25 items, recipients, verifiers, rules and provisions release states', async () => {
    const result = await seedDemo();
    expect(result.items).toBe(25);
    expect(result.recipients).toBe(2);
    expect(result.verifiers).toBe(2);
    expect(result.rules).toBe(4);
    expect(mockEnsure).toHaveBeenCalledTimes(2); // emergency + estate
  });

  it('wires dependency edges in a second pass (UPDATE depends_on_item_id)', async () => {
    await seedDemo();
    const edgeUpdates = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('SET depends_on_item_id'),
    );
    // chase, bofa, fidelity → gmail = 3 edges
    expect(edgeUpdates.length).toBe(3);
  });

  it('stores placeholder ciphertext as a Buffer (BYTEA), not plaintext', async () => {
    await seedDemo();
    const itemInsert = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO vault_items'),
    );
    const params = itemInsert![1] as unknown[];
    expect(Buffer.isBuffer(params[12])).toBe(true); // ciphertext
    expect(Buffer.isBuffer(params[13])).toBe(true); // wrapped_data_key
  });
});
