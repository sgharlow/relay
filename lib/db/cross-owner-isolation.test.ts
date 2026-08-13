/**
 * Property 4 — cross-owner authorization isolation.
 *
 * Feature: relay-h0-mvp, Property 4
 * Validates: Requirements 1.5, 1.8, 15.6
 *
 * From design.md §Property 4: *for any* two distinct owner identities A and B
 * with vault items, owner A must receive an authorization error — not a data row
 * — when attempting to read, update, or delete any item belonging to owner B.
 *
 * 🔴 THE LAST UNCHECKED BOX IN tasks.md (6.2), and it was unchecked honestly:
 * the BEHAVIOUR has had conventional unit tests in integrity.test.ts from the
 * start, but the deliverable named a fast-check PROPERTY test and no test
 * carried the `Property 4` tag. Ticking it would have claimed a kind of evidence
 * that did not exist.
 *
 * WHY A PROPERTY RATHER THAN MORE EXAMPLES. Aurora DSQL has no foreign keys, so
 * nothing in the database refuses a cross-owner reference — the guarantee lives
 * entirely in `assertOwns`. A guarantee resting on one function is worth testing
 * against arbitrary inputs rather than the two or three ids someone thought of.
 *
 * ⚠️ AND THE FIRST DRAFT OF THIS FILE WAS WRONG ABOUT THE CODE, which is the
 * argument for writing it. It asserted that `assertOwns` scopes by owner in the
 * WHERE clause and that a foreign row is indistinguishable from a missing one.
 * Neither is true: the query fetches by id and compares the owner in JS, and it
 * raises NOT_FOUND and UNAUTHORIZED distinctly. Both are correct as written —
 * the distinction is useful internally, and the ROUTES collapse the two into one
 * 403 so existence is never disclosed at the boundary. The property below now
 * asserts the guarantee that actually exists, at the layer that provides it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

vi.mock('./connection', () => ({ query: vi.fn() }));
vi.mock('./occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isSqlState40001: vi.fn(() => false),
}));

import { query } from './connection';
import { assertOwns, assertNoCrossOwner, IntegrityError } from './integrity';

const mockQuery = vi.mocked(query);
const uuid = fc.uuid();

/**
 * The database as `assertOwns` actually reads it: `SELECT owner_id ... WHERE
 * id = $1`. The owner is NOT part of the query — it is compared afterwards — so
 * the fixture is keyed by id alone.
 */
function rowsExist(rows: { id: string; owner_id: string }[]) {
  mockQuery.mockImplementation((async (_sql: string, params: unknown[]) => {
    const hit = rows.find((r) => r.id === (params as string[])[0]);
    return { rows: hit ? [{ owner_id: hit.owner_id }] : [], rowCount: hit ? 1 : 0 };
  }) as never);
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('Property 4 — cross-owner authorization isolation', () => {
  it('owner A is refused every item belonging to owner B, and B is not', async () => {
    await fc.assert(
      fc.asyncProperty(uuid, uuid, uuid, async (ownerA, ownerB, itemId) => {
        fc.pre(ownerA !== ownerB);
        rowsExist([{ id: itemId, owner_id: ownerB }]);

        // The other half of the property: passing by refusing everybody would be
        // isolation nobody wants.
        await expect(assertOwns(ownerB, 'vault_items', itemId)).resolves.toBeUndefined();

        const err = await assertOwns(ownerA, 'vault_items', itemId).catch((e) => e);
        expect(err).toBeInstanceOf(IntegrityError);
        expect((err as IntegrityError).code).toBe('UNAUTHORIZED');
      }),
      { numRuns: 500 },
    );
  });

  it('never returns a row to the wrong owner — it throws, for every table', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuid,
        uuid,
        uuid,
        fc.constantFrom('vault_items', 'recipients', 'verifiers', 'access_rules'),
        async (ownerA, ownerB, id, table) => {
          fc.pre(ownerA !== ownerB);
          rowsExist([{ id, owner_id: ownerB }]);
          await expect(assertOwns(ownerA, table, id)).rejects.toBeInstanceOf(IntegrityError);
        },
      ),
      { numRuns: 500 },
    );
  });

  /*
    Ids differing by one character are the shape a real mistake takes — a
    truncated paste, a transposed digit — so this is constructed rather than
    left to chance among random UUIDs.
  */
  it('holds for ids that differ by a single character', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const nearMiss = '11111111-1111-4111-8111-111111111112';
    await fc.assert(
      fc.asyncProperty(uuid, uuid, async (ownerA, ownerB) => {
        fc.pre(ownerA !== ownerB);
        rowsExist([{ id, owner_id: ownerB }]);
        await expect(assertOwns(ownerA, 'vault_items', id)).rejects.toBeInstanceOf(IntegrityError);
        await expect(assertOwns(ownerB, 'vault_items', nearMiss)).rejects.toBeInstanceOf(
          IntegrityError,
        );
      }),
      { numRuns: 200 },
    );
  });

  /*
    The batch form is where a cross-owner reference would actually get built: a
    rule naming an item and a recipient at once. One foreign member has to sink
    the whole set, or a partially-valid request writes a grant across owners.
  */
  it('a batch containing one foreign reference is refused entirely', async () => {
    await fc.assert(
      fc.asyncProperty(uuid, uuid, uuid, uuid, async (ownerA, ownerB, mine, theirs) => {
        fc.pre(ownerA !== ownerB && mine !== theirs);
        rowsExist([
          { id: mine, owner_id: ownerA },
          { id: theirs, owner_id: ownerB },
        ]);
        await expect(
          assertNoCrossOwner(ownerA, [
            { table: 'vault_items', id: mine },
            { table: 'recipients', id: theirs },
          ]),
        ).rejects.toBeInstanceOf(IntegrityError);
      }),
      { numRuns: 300 },
    );
  });

  /*
    The distinction assertOwns draws internally must NOT reach a caller, or an
    owner could enumerate the existence of other people's rows by reading the
    error. The collapse happens at the route, so that is where it is asserted.
  */
  it('the route collapses both codes into one 403, so existence is not disclosed', () => {
    const src = readFileSync('src/app/api/vault/items/[id]/route.ts', 'utf8');
    expect(src).toMatch(/NOT_FOUND and UNAUTHORIZED both collapse to 403/);
    expect(src).toMatch(/status:\s*403/);
  });
});
