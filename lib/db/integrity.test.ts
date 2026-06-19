/**
 * Tests for lib/db/integrity.ts
 *
 * Validates: Requirements 16.1, 16.2, 16.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mock lib/db/connection so no real DB is needed
// ---------------------------------------------------------------------------

vi.mock('./connection', () => ({
  query: vi.fn(),
}));

// Mock occ — we want to test integrity logic in isolation; OCC retry behaviour
// is covered in occ.test.ts.  Here we make withOccRetry a transparent pass-through.
vi.mock('./occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isSqlState40001: vi.fn((err: unknown) => {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>).code === '40001'
    );
  }),
}));

import { query } from './connection';
import { withOccRetry } from './occ';
import {
  IntegrityError,
  assertOwns,
  cascadeDelete,
  assertNoCrossOwner,
} from './integrity';

const mockQuery = vi.mocked(query);
const mockWithOccRetry = vi.mocked(withOccRetry);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryResult(rows: Record<string, unknown>[], rowCount?: number) {
  return {
    rows,
    rowCount: rowCount ?? rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

// ---------------------------------------------------------------------------
// IntegrityError
// ---------------------------------------------------------------------------

describe('IntegrityError', () => {
  it('is an instance of Error', () => {
    const err = new IntegrityError('NOT_FOUND', 'missing row');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of IntegrityError', () => {
    const err = new IntegrityError('NOT_FOUND', 'missing row');
    expect(err).toBeInstanceOf(IntegrityError);
  });

  it('has name "IntegrityError"', () => {
    const err = new IntegrityError('UNAUTHORIZED', 'wrong owner');
    expect(err.name).toBe('IntegrityError');
  });

  it('exposes code NOT_FOUND', () => {
    const err = new IntegrityError('NOT_FOUND', 'missing');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('exposes code UNAUTHORIZED', () => {
    const err = new IntegrityError('UNAUTHORIZED', 'bad owner');
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('exposes code INTEGRITY_ERROR', () => {
    const err = new IntegrityError('INTEGRITY_ERROR', 'general');
    expect(err.code).toBe('INTEGRITY_ERROR');
  });

  it('exposes the message', () => {
    const err = new IntegrityError('NOT_FOUND', 'row recipients/abc not found');
    expect(err.message).toBe('row recipients/abc not found');
  });
});

// ---------------------------------------------------------------------------
// assertOwns
// ---------------------------------------------------------------------------

describe('assertOwns', () => {
  const OWNER = 'owner-uuid-1';
  const OTHER = 'owner-uuid-2';
  const TABLE = 'vault_items';
  const ID = 'item-uuid-1';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: transparent retry wrapper
    mockWithOccRetry.mockImplementation(async (fn) => fn());
  });

  it('resolves when row exists and owner_id matches', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ owner_id: OWNER }]) as never);
    await expect(assertOwns(OWNER, TABLE, ID)).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND when rowCount is 0', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);

    await expect(assertOwns(OWNER, TABLE, ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND when rows array is empty', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([]) as never);

    await expect(assertOwns(OWNER, TABLE, ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws UNAUTHORIZED when owner_id does not match', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ owner_id: OTHER }]) as never);

    await expect(assertOwns(OWNER, TABLE, ID)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('thrown error is an instance of IntegrityError', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);

    await expect(assertOwns(OWNER, TABLE, ID)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('passes the id as a query parameter', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ owner_id: OWNER }]) as never);
    await assertOwns(OWNER, TABLE, ID);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining(TABLE),
      [ID],
    );
  });

  it('wraps the query in withOccRetry', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([{ owner_id: OWNER }]) as never);
    await assertOwns(OWNER, TABLE, ID);

    expect(mockWithOccRetry).toHaveBeenCalledTimes(1);
  });

  it('propagates non-IntegrityError exceptions from query', async () => {
    const dbErr = new Error('connection refused');
    mockQuery.mockRejectedValueOnce(dbErr);

    await expect(assertOwns(OWNER, TABLE, ID)).rejects.toBe(dbErr);
  });
});

// ---------------------------------------------------------------------------
// cascadeDelete
// ---------------------------------------------------------------------------

describe('cascadeDelete', () => {
  const TABLE = 'access_rules';
  const PARENT_ID = 'vault-item-uuid-1';
  const FK_COLUMN = 'vault_item_id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWithOccRetry.mockImplementation(async (fn) => fn());
  });

  it('resolves without error when rows are deleted', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);
    await expect(cascadeDelete(TABLE, PARENT_ID, FK_COLUMN)).resolves.toBeUndefined();
  });

  it('issues a DELETE query with the parentId as parameter', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);
    await cascadeDelete(TABLE, PARENT_ID, FK_COLUMN);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM'),
      [PARENT_ID],
    );
  });

  it('uses the correct table and fkColumn in the query', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);
    await cascadeDelete(TABLE, PARENT_ID, FK_COLUMN);

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(TABLE);
    expect(sql).toContain(FK_COLUMN);
  });

  it('wraps the DELETE in withOccRetry', async () => {
    mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);
    await cascadeDelete(TABLE, PARENT_ID, FK_COLUMN);

    expect(mockWithOccRetry).toHaveBeenCalledTimes(1);
  });

  it('propagates DB errors', async () => {
    const dbErr = new Error('timeout');
    mockQuery.mockRejectedValueOnce(dbErr);

    await expect(cascadeDelete(TABLE, PARENT_ID, FK_COLUMN)).rejects.toBe(dbErr);
  });
});

// ---------------------------------------------------------------------------
// assertNoCrossOwner
// ---------------------------------------------------------------------------

describe('assertNoCrossOwner', () => {
  const OWNER = 'owner-uuid-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWithOccRetry.mockImplementation(async (fn) => fn());
  });

  it('resolves when all refs are owned by ownerId', async () => {
    mockQuery.mockResolvedValue(makeQueryResult([{ owner_id: OWNER }]) as never);

    const refs = [
      { table: 'vault_items', id: 'id-1' },
      { table: 'recipients', id: 'id-2' },
    ];
    await expect(assertNoCrossOwner(OWNER, refs)).resolves.toBeUndefined();
  });

  it('resolves when refs array is empty', async () => {
    await expect(assertNoCrossOwner(OWNER, [])).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects with NOT_FOUND if any ref row does not exist', async () => {
    // First call returns a valid row; second returns empty (not found)
    mockQuery
      .mockResolvedValueOnce(makeQueryResult([{ owner_id: OWNER }]) as never)
      .mockResolvedValueOnce(makeQueryResult([], 0) as never);

    const refs = [
      { table: 'vault_items', id: 'id-1' },
      { table: 'recipients', id: 'id-missing' },
    ];
    await expect(assertNoCrossOwner(OWNER, refs)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects with UNAUTHORIZED if any ref is owned by a different owner', async () => {
    mockQuery
      .mockResolvedValueOnce(makeQueryResult([{ owner_id: OWNER }]) as never)
      .mockResolvedValueOnce(makeQueryResult([{ owner_id: 'other-owner' }]) as never);

    const refs = [
      { table: 'vault_items', id: 'id-1' },
      { table: 'access_rules', id: 'id-2' },
    ];
    await expect(assertNoCrossOwner(OWNER, refs)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('calls assertOwns once per ref', async () => {
    mockQuery.mockResolvedValue(makeQueryResult([{ owner_id: OWNER }]) as never);

    const refs = [
      { table: 'vault_items', id: 'id-1' },
      { table: 'vault_items', id: 'id-2' },
      { table: 'recipients', id: 'id-3' },
    ];
    await assertNoCrossOwner(OWNER, refs);

    expect(mockQuery).toHaveBeenCalledTimes(refs.length);
  });

  it('runs checks in parallel (withOccRetry called once per ref)', async () => {
    mockQuery.mockResolvedValue(makeQueryResult([{ owner_id: OWNER }]) as never);

    const refs = [
      { table: 'vault_items', id: 'id-a' },
      { table: 'vault_items', id: 'id-b' },
    ];
    await assertNoCrossOwner(OWNER, refs);

    // One withOccRetry invocation per ref (from assertOwns)
    expect(mockWithOccRetry).toHaveBeenCalledTimes(refs.length);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// **Validates: Requirements 16.1, 16.2, 16.3**
// ---------------------------------------------------------------------------

describe('assertOwns — property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithOccRetry.mockImplementation(async (fn) => fn());
  });

  it(
    'property: row with matching owner_id always resolves, non-matching always throws UNAUTHORIZED',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          async (ownerId, otherOwnerId, id) => {
            fc.pre(ownerId !== otherOwnerId);

            // Case 1: matching owner → should resolve
            mockQuery.mockResolvedValueOnce(
              makeQueryResult([{ owner_id: ownerId }]) as never,
            );
            await expect(assertOwns(ownerId, 'vault_items', id)).resolves.toBeUndefined();

            // Case 2: different owner → should throw UNAUTHORIZED
            mockQuery.mockResolvedValueOnce(
              makeQueryResult([{ owner_id: otherOwnerId }]) as never,
            );
            await expect(assertOwns(ownerId, 'vault_items', id)).rejects.toMatchObject({
              code: 'UNAUTHORIZED',
            });

            return true;
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  it(
    'property: missing row always throws NOT_FOUND regardless of ownerId or table',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          fc.constantFrom('recipients', 'verifiers', 'vault_items', 'access_rules', 'release_state'),
          async (ownerId, id, table) => {
            mockQuery.mockResolvedValueOnce(makeQueryResult([], 0) as never);

            await expect(assertOwns(ownerId, table, id)).rejects.toMatchObject({
              code: 'NOT_FOUND',
            });

            return true;
          },
        ),
        { numRuns: 50 },
      );
    },
  );
});

describe('assertNoCrossOwner — property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithOccRetry.mockImplementation(async (fn) => fn());
  });

  it(
    'property: all refs owned by ownerId always resolves',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.array(
            fc.record({
              table: fc.constantFrom('recipients', 'vault_items', 'access_rules'),
              id: fc.uuid(),
            }),
            { minLength: 0, maxLength: 5 },
          ),
          async (ownerId, refs) => {
            mockQuery.mockResolvedValue(makeQueryResult([{ owner_id: ownerId }]) as never);

            await expect(assertNoCrossOwner(ownerId, refs)).resolves.toBeUndefined();

            mockQuery.mockReset();
            mockQuery.mockResolvedValue(makeQueryResult([{ owner_id: ownerId }]) as never);

            return true;
          },
        ),
        { numRuns: 30 },
      );
    },
  );
});
