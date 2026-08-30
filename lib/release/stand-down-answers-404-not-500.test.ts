/**
 * An id that cannot name a release gets a 404, not a 500.
 *
 * 🔴 FOUND BY A LIVE WALK, 2026-08-30 (B15.2). `scripts/e2e-decision.ts` posted
 * to `/api/triggers/emergency/stand-down` — the URL shape `/initiate` and
 * `/config` take, where `[id]` is a trigger TYPE. Stand-down takes a
 * release_state UUID there, so the literal string reached the database as
 * `WHERE id = 'emergency'`, DSQL raised SQLSTATE 22P02 (`invalid input syntax
 * for type uuid`), nothing caught it, and the route answered 500.
 *
 * WHY THIS IS WORTH A TEST RATHER THAN A SHRUG. Stand-down is the product's ONLY
 * stop control — `/cancel` was retired on 2026-08-21 — and its own route header
 * says that if it stops working "an owner has no way at all to halt a false
 * alarm short of checking in". A 500 tells an owner in a hurry the same thing a
 * database outage would, and the two call for opposite responses.
 *
 * ⚠️ WHAT THIS DOES NOT DO, said plainly because the walk that found it could
 * not see this either: it does not stop the two URL shapes from differing.
 * `/api/triggers/[id]/initiate` genuinely takes a trigger type and
 * `/api/triggers/[id]/stand-down` genuinely takes a release id, and unifying
 * them is an API change, not a bug fix. What is fixed is the ANSWER — a request
 * that cannot name a release is told so, once, in the way an absent release is
 * told.
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.3, J9-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => undefined) }));
vi.mock('../notify/notifications', () => ({
  notifyRecipientsOfRelease: vi.fn(async () => undefined),
  notifyRecipientsOfClosure: vi.fn(async () => undefined),
}));

import { query } from '../db/connection';
import { standDownTrigger, TriggerError } from './triggers';

const mockQuery = vi.mocked(query);
const machine = { transition: vi.fn() };

/** What `pg` surfaces for an unparseable parameter: the SQLSTATE on `code`. */
function castError(): Error & { code: string } {
  const err = new Error('invalid input syntax for type uuid: "emergency"') as Error & {
    code: string;
  };
  err.code = '22P02';
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an id the database cannot parse', () => {
  it('is a 404, not an unhandled throw', async () => {
    mockQuery.mockRejectedValueOnce(castError());

    await expect(standDownTrigger('owner-1', 'emergency', machine)).rejects.toBeInstanceOf(
      TriggerError,
    );
  });

  it('carries HTTP 404 so the route answers it rather than rethrowing', async () => {
    mockQuery.mockRejectedValueOnce(castError());

    await standDownTrigger('owner-1', 'emergency', machine).then(
      () => expect.fail('should have thrown'),
      (err: TriggerError) => expect(err.httpStatus).toBe(404),
    );
  });

  /*
    The same sentence an absent release gets. A different message would let a
    caller distinguish "no such id shape" from "no such row", which is a
    distinction nobody outside this file needs and one that leaks into an error
    echoed back to whoever holds the link.
  */
  it('says the same thing an absent release says', async () => {
    mockQuery.mockRejectedValueOnce(castError());
    const malformed = await standDownTrigger('owner-1', 'emergency', machine).catch(
      (e: Error) => e.message,
    );

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const absent = await standDownTrigger('owner-1', 'rs-nope', machine).catch(
      (e: Error) => e.message,
    );

    expect(malformed).toBe(absent);
  });

  /*
    🔴 THE HALF THAT MATTERS MORE. Swallowing every database error here would
    turn a real outage into a cheerful "not found" — the owner is told their
    release does not exist while the cluster is down, and the stop control fails
    silently instead of loudly. Only the cast is caught.
  */
  it('does NOT swallow a real database failure', async () => {
    const outage = new Error('connection terminated unexpectedly') as Error & { code: string };
    outage.code = '08006';
    mockQuery.mockRejectedValueOnce(outage);

    await expect(standDownTrigger('owner-1', 'rs-1', machine)).rejects.toThrow(
      /connection terminated/,
    );
  });

  it('does not swallow an error with no SQLSTATE at all', async () => {
    mockQuery.mockRejectedValueOnce(new Error('something else entirely'));

    await expect(standDownTrigger('owner-1', 'rs-1', machine)).rejects.toThrow(
      /something else entirely/,
    );
  });
});
