/**
 * A re-armed trigger must start its NEXT emergency with a clean tally.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, found 2026-08-21 by an audit of J7/J9
 * against the code. `release_state` is ONE PERMANENT ROW per (owner, trigger_type)
 * — `ensureReleaseState` returns the existing row and nothing ever deletes it.
 * `verifier_confirmations` keys on that permanent `release_state_id` and on
 * nothing else, and `submitConfirmation`'s idempotency read was:
 *
 *     SELECT id FROM verifier_confirmations
 *       WHERE release_state_id = $1 AND verifier_id = $2
 *
 * So the ledger is not a record of THIS release. It is a record of every release
 * that trigger has ever had, and three things followed:
 *
 *  (a) **A verifier can answer once, ever.** Stand down a false alarm, and next
 *      month the same verifier gets `duplicate`: the token door says "Recorded",
 *      their standby dashboard shows nothing waiting, and the tally does not
 *      move. On the 1-of-1 rosters the beta actually has, the SECOND emergency
 *      can never reach quorum at all. The one thing the product exists to do,
 *      broken on the second use, silently, for the people who did nothing wrong.
 *
 *  (b) **Partial confirmations carry forward.** `standDownTrigger` and
 *      `processCheckin` both reset `received_confirmations` only when the state
 *      was RELEASED. Standing down from PENDING or GRACE left the count intact,
 *      so a 2-of-3 with one confirmation already in starts the next emergency
 *      pre-confirmed and fires on fewer verifiers than the owner configured.
 *      Both call sites carry a comment claiming this is handled ("the next
 *      emergency starts pre-confirmed — it would fire on fewer verifiers than
 *      the owner configured"), which is exactly the case it did not cover.
 *
 *  (c) **Denials are never reset on any path.** `received_denials` was not even
 *      in `UPDATABLE_COLUMNS`, so no transition could clear it. Old objections
 *      counted toward unreachability forever, and the objectors could not
 *      re-vote.
 *
 * THE FIX NEEDS NO MIGRATION, which is why it is taken now rather than filed.
 * Every one of the five paths that starts a release already stamps
 * `initiated_at` (owner initiate, owner-consent challenge, lapse escalation,
 * cron heartbeat, demo simulate), so the current release instance already has a
 * marker. The idempotency read is scoped to it; a NULL `initiated_at` falls back
 * to the old unscoped behaviour, which is the conservative direction — it can
 * only refuse an answer, never invent one.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.4, J7-R9 (one decision per release INSTANCE), J9 step 2/6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../db/integrity', () => ({ recordIntegrityAction: vi.fn(async () => undefined) }));
vi.mock('../notify/notifications', () => ({
  notifyRecipientsOfRelease: vi.fn(async () => 0),
  notifyRecipientsOfClosure: vi.fn(async () => 0),
}));
vi.mock('../billing/entitlements', () => ({ assertCanRelease: vi.fn(async () => undefined) }));

import { query } from '../db/connection';
import { submitConfirmation, standDownTrigger } from './triggers';
import { UPDATABLE_COLUMNS } from './state-machine';
import type { ReleaseStateRow } from './state-machine';

const mockQuery = vi.mocked(query);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

interface Ledger {
  id: string;
  release_state_id: string;
  verifier_id: string;
  confirmed_at: string;
  decision: string;
}

/**
 * A sim that models the one thing the old one could not: WHEN a confirmation was
 * written. The previous fixture stored no `confirmed_at` and its
 * `verifier_confirmations` branch ignored every parameter after the second — so
 * a scoped read and an unscoped read were indistinguishable inside it, and the
 * bug was invisible to a test suite that otherwise covered this file heavily.
 */
function installSim(initial: Partial<ReleaseStateRow>, clock: { now: string }) {
  const row: ReleaseStateRow & { version: number; received_denials: number } = {
    id: 'rs-1',
    owner_id: 'owner-1',
    trigger_type: 'emergency',
    state: 'grace',
    required_confirmations: 1,
    received_confirmations: 0,
    received_denials: 0,
    version: 0,
    initiated_by: 'owner:owner-1',
    initiated_at: '2026-01-01T00:00:00.000Z',
    grace_ends_at: '2020-01-01T00:00:00Z',
    released_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...initial,
  } as never;

  const ledger: Ledger[] = [];

  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const p = (params ?? []) as unknown[];

    if (sql.includes('FROM verifier_confirmations')) {
      const since = p[2] as string | null | undefined;
      const matches = ledger.filter(
        (c) =>
          c.release_state_id === p[0] &&
          c.verifier_id === p[1] &&
          (since == null || new Date(c.confirmed_at).getTime() >= new Date(since).getTime()),
      );
      return qResult(matches.map((c) => ({ id: c.id })));
    }
    if (sql.startsWith('INSERT INTO verifier_confirmations')) {
      ledger.push({
        id: `c${ledger.length}`,
        release_state_id: p[0] as string,
        verifier_id: p[1] as string,
        confirmed_at: clock.now,
        decision: sql.includes("'deny'") ? 'deny' : 'confirm',
      });
      return qResult([]);
    }
    if (sql.startsWith('SELECT * FROM release_state')) return qResult([{ ...row }]);
    if (sql.includes('received_denials =')) {
      row.received_denials += 1;
      row.version += 1;
      return qResult([{ ...row }]);
    }
    if (sql.includes('claimed_user_id, standby_state FROM verifiers WHERE id = $1')) {
      return qResult([{ id: p[0], claimed_user_id: null, standby_state: 'confirmed' }]);
    }
    if (sql.includes('claimed_user_id, standby_state FROM verifiers WHERE owner_id = $1')) {
      return qResult([{ id: 'v-1', claimed_user_id: null, standby_state: 'confirmed' }]);
    }
    if (sql.includes('FROM recipients r')) return qResult([]);
    if (sql.startsWith('UPDATE release_state')) {
      if (Number(p[1]) === row.version) {
        row.received_confirmations += 1;
        row.version += 1;
        return qResult([{ ...row }]);
      }
      return qResult([]);
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  return { row, ledger };
}

/**
 * A transition stub that applies `updates` to the row the way the real machine
 * does, so a test can assert on what a stand-down actually left behind rather
 * than on which arguments were passed.
 */
function machineFor(sim: { row: ReleaseStateRow & { version: number } }) {
  return {
    releaseFromGrace: vi.fn(async () => ({}) as never),
    safeResetToArmed: vi.fn(async () => undefined),
    transition: vi.fn(
      async (
        _id: string,
        _from: string,
        to: string,
        _version: string | number,
        opts?: { updates?: Record<string, unknown> },
      ) => {
        Object.assign(sim.row, opts?.updates ?? {});
        sim.row.state = to as never;
        sim.row.version += 1;
        return { ...sim.row } as never;
      },
    ),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('a re-armed trigger starts the next emergency with a clean tally', () => {
  it('the same verifier can answer the NEXT release after a stand-down', async () => {
    const clock = { now: '2026-03-01T00:00:00.000Z' };
    const sim = installSim({ initiated_at: '2026-03-01T00:00:00.000Z', required_confirmations: 2 }, clock);
    const machine = machineFor(sim);

    // Release 1 — Alice confirms.
    const first = await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-1',
      machine,
      now: new Date(clock.now),
    });
    expect(first.status).toBe('recorded');

    // The owner stands the false alarm down.
    sim.row.state = 'grace';
    await standDownTrigger('owner-1', 'rs-1', machine);
    expect(sim.row.state).toBe('armed');

    // Release 2, a month later. This is the whole point: Alice must be able to
    // answer again. Before the fix she got `duplicate` and the tally never moved.
    clock.now = '2026-04-01T00:00:00.000Z';
    sim.row.state = 'grace';
    sim.row.initiated_at = '2026-04-01T00:00:00.000Z';
    sim.row.grace_ends_at = '2020-01-01T00:00:00Z';

    const second = await submitConfirmation({
      releaseStateId: 'rs-1',
      verifierId: 'v-1',
      machine,
      now: new Date(clock.now),
    });

    expect(second.status, 'the same verifier was refused on the next release').toBe('recorded');
    expect(sim.ledger.length, 'the second answer was never written to the ledger').toBe(2);
  });

  it('a stand-down from GRACE clears a partial confirmation count', async () => {
    const clock = { now: '2026-03-01T00:00:00.000Z' };
    const sim = installSim(
      { state: 'grace', required_confirmations: 3, received_confirmations: 2 },
      clock,
    );
    const machine = machineFor(sim);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect(
      sim.row.received_confirmations,
      'a stood-down GRACE carried its confirmations into the next release — it would fire on fewer verifiers than the owner configured',
    ).toBe(0);
  });

  it('a stand-down clears denials as well as confirmations', async () => {
    const clock = { now: '2026-03-01T00:00:00.000Z' };
    const sim = installSim({ state: 'pending', received_denials: 2 }, clock);
    const machine = machineFor(sim);

    await standDownTrigger('owner-1', 'rs-1', machine);

    expect(
      Number(sim.row.received_denials ?? 0),
      'old objections still counted toward unreachability on the next release',
    ).toBe(0);
  });

  it('received_denials is a column a transition is allowed to set', () => {
    // The reset above is silently a no-op unless the state machine will write
    // this column: `applyUpdates` filters against UPDATABLE_COLUMNS, so an
    // un-listed key is dropped without an error. That is the shape where a fix
    // looks applied and does nothing.
    expect(UPDATABLE_COLUMNS.has('received_denials')).toBe(true);
  });
});
