/**
 * Tests for lib/release/heartbeat.ts
 *
 * Validates: Requirements 4.2, 4.3, 4.5, 4.7
 *  - Property 9:  Heartbeat overdue detection
 *  - Property 10: Heartbeat recovery (PENDING → ARMED); estate rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../notify/notifications', () => ({
  notifyRecipientsOfClosure: vi.fn(async () => 0),
  notifyRecipientsOfRelease: vi.fn(async () => 0),
  notifyOwnerTriggerPending: vi.fn(async () => undefined),
  notifyVerifiersForTrigger: vi.fn(async () => 0),
  toVerifierContact: (v: { id: string; name: string; email: string; email_secondary?: string | null }) => ({
    id: v.id,
    name: v.name,
    email: v.email,
    email_secondary: v.email_secondary ?? null,
  }),
}));
vi.mock('../people/verifiers', () => ({
  listVerifiers: vi.fn(async () => [{ id: 'v1', name: 'Dr. Chen', email: 'chen@example.com' }]),
}));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  notifyOwnerTriggerPending,
  notifyVerifiersForTrigger,
} from '../notify/notifications';
import { isOverdue, processCheckin, runHeartbeatSweep , resolveElapsedGrace } from './heartbeat';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 9 — overdue detection
// ---------------------------------------------------------------------------

describe('Property 9: heartbeat overdue detection', () => {
  it('isOverdue is true iff elapsed time strictly exceeds the interval', () => {
    // Feature: relay-h0-mvp, Property 9
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }), // intervalDays
        fc.integer({ min: -400, max: 400 }), // offset days vs the exact boundary
        (intervalDays, offsetDays) => {
          const now = new Date('2026-06-18T00:00:00Z');
          // last_active_at = now - (intervalDays + offsetDays) days
          const elapsedDays = intervalDays + offsetDays;
          const lastActiveAt = new Date(now.getTime() - elapsedDays * MS_PER_DAY);
          const expected = elapsedDays * MS_PER_DAY > intervalDays * MS_PER_DAY;
          expect(isOverdue(lastActiveAt, intervalDays, now)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('exactly-at-interval is not yet overdue', () => {
    const now = new Date('2026-06-18T00:00:00Z');
    const last = new Date(now.getTime() - 30 * MS_PER_DAY);
    expect(isOverdue(last, 30, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 10 — heartbeat recovery
// ---------------------------------------------------------------------------

describe('Property 10: heartbeat recovery (PENDING → ARMED); estate rejected', () => {
  it('reversible triggers in PENDING reset to ARMED; estate is blocked', async () => {
    // Feature: relay-h0-mvp, Property 10
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('emergency', 'travel', 'caregiver', 'business', 'estate'),
        fc.constantFrom('pending', 'grace'),
        async (triggerType, state) => {
          vi.clearAllMocks();
          const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);

          mockQuery.mockImplementation(async (sql: string) => {
            if (sql.startsWith('UPDATE users')) return qResult([]);
            if (sql.includes('FROM release_state')) {
              return qResult([{ id: 'rs-1', trigger_type: triggerType, state, version: '0' }]);
            }
            return qResult([]);
          });

          const result = await processCheckin('owner-1', { transition } as never);

          if (triggerType === 'estate') {
            expect(result.blocked).toEqual(['estate']);
            expect(result.reset).toEqual([]);
            expect(transition).not.toHaveBeenCalled();
          } else {
            expect(result.reset).toEqual([triggerType]);
            expect(result.blocked).toEqual([]);
            expect(transition).toHaveBeenCalledOnce();
            // transitions to 'armed' from the current PENDING/GRACE state
            expect(transition.mock.calls[0][2]).toBe('armed');
            expect(transition.mock.calls[0][1]).toBe(state);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('records the heartbeat (updates last_active_at) and writes an audit entry', async () => {
    const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      return qResult([]); // no pending/grace rows
    });
    await processCheckin('owner-1', { transition } as never);
    expect(mockQuery.mock.calls[0][0]).toContain('UPDATE users SET last_active_at');
    expect(mockAudit.mock.calls[0][1].action).toBe('owner_checkin');
  });

  it('re-arms a RELEASED reversible trigger (closing access) and resets the bookkeeping', async () => {
    const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      if (sql.includes('FROM release_state')) {
        return qResult([{ id: 'rs-1', trigger_type: 'emergency', state: 'released', version: '3' }]);
      }
      return qResult([]);
    });
    const result = await processCheckin('owner-1', { transition } as never);
    expect(result.reset).toEqual(['emergency']);
    expect(transition).toHaveBeenCalledOnce();
    expect(transition.mock.calls[0][1]).toBe('released'); // from
    expect(transition.mock.calls[0][2]).toBe('armed'); // to
    const opts = transition.mock.calls[0][4] as { updates?: Record<string, unknown> };
    expect(opts.updates).toMatchObject({ received_confirmations: 0, grace_ends_at: null, released_at: null });
  });

  it('blocks a RELEASED estate trigger (permanent — cannot reverse)', async () => {
    const transition = vi.fn(async (..._a: unknown[]) => ({}) as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      if (sql.includes('FROM release_state')) {
        return qResult([{ id: 'rs-2', trigger_type: 'estate', state: 'released', version: '3' }]);
      }
      return qResult([]);
    });
    const result = await processCheckin('owner-1', { transition } as never);
    expect(result.blocked).toEqual(['estate']);
    expect(transition).not.toHaveBeenCalled();
  });

  it('does not fail the whole check-in if one reversible row races (CAS error)', async () => {
    const transition = vi.fn(async () => {
      throw new Error('CAS mismatch');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users')) return qResult([]);
      if (sql.includes('FROM release_state')) {
        return qResult([{ id: 'rs-1', trigger_type: 'emergency', state: 'pending', version: '0' }]);
      }
      return qResult([]);
    });
    const result = await processCheckin('owner-1', { transition } as never);
    expect(result).toEqual({ reset: [], blocked: [] });
  });
});

// ---------------------------------------------------------------------------
// Cron sweep
// ---------------------------------------------------------------------------

describe('runHeartbeatSweep', () => {
  function setupOwners(armedRows: Record<string, unknown>[]) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return qResult([{ id: 'owner-1' }]);
      if (sql.includes("state = 'armed'")) return qResult(armedRows);
      return qResult([]);
    });
  }

  it('advances each overdue ARMED release_state through PENDING into GRACE', async () => {
    setupOwners([{ id: 'rs-1', trigger_type: 'emergency', version: '0' }]);
    const transition = vi
      .fn()
      .mockResolvedValueOnce({ id: 'rs-1', version: 1 } as never) // armed -> pending
      .mockResolvedValueOnce({ id: 'rs-1', version: 2 } as never); // pending -> grace

    const res = await runHeartbeatSweep({ transition } as never, { sleep: async () => {}, now: () => new Date('2026-06-18T00:00:00Z') });
    expect(res).toEqual({ evaluated: 1, transitioned: 1, failures: 0 });
    expect(transition.mock.calls[0][1]).toBe('armed');
    expect(transition.mock.calls[0][2]).toBe('pending');
    expect(transition.mock.calls[1][1]).toBe('pending');
    expect(transition.mock.calls[1][2]).toBe('grace');
    // the GRACE transition stamps the grace window
    expect((transition.mock.calls[1][4] as { updates?: { grace_ends_at?: string } }).updates?.grace_ends_at).toBeDefined();
  });

  it('retries a failing owner then logs + counts a failure (Req 4.7)', async () => {
    setupOwners([{ id: 'rs-1', trigger_type: 'emergency', version: '0' }]);
    const transition = vi.fn(async () => {
      throw new Error('transient');
    });
    const sleep = vi.fn(async () => {});

    const res = await runHeartbeatSweep({ transition } as never, { sleep, now: () => new Date('2026-06-18T00:00:00Z') });
    expect(res).toEqual({ evaluated: 1, transitioned: 0, failures: 1 });
    expect(transition).toHaveBeenCalledTimes(3); // max 3 attempts
    expect(sleep).toHaveBeenCalledTimes(2); // backoff between attempts
  });
});

/**
 * resolveElapsedGrace — the resolver that makes GRACE_WINDOW_MS configurable.
 *
 * Until this existed, raising the grace window above 0 did not create an
 * owner-cancel window; it stranded releases, because submitConfirmation
 * evaluates canRelease exactly once and nothing re-drove a GRACE row.
 */
describe('resolveElapsedGrace', () => {
  it('releases a row whose window has elapsed AND whose quorum is met', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rs-1', owner_id: 'o-1', trigger_type: 'emergency', version: 3, received_confirmations: 2, required_confirmations: 2 }],
      rowCount: 1,
    } as never);
    const machine = { transition: vi.fn(async (..._a: unknown[]) => ({}) as never) };

    await expect(resolveElapsedGrace(machine as never, new Date())).resolves.toBe(1);
    expect(machine.transition.mock.calls[0][1]).toBe('grace');
    expect(machine.transition.mock.calls[0][2]).toBe('released');
  });

  it('only selects rows that already have every confirmation they need', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await resolveElapsedGrace({ transition: vi.fn() } as never, new Date());

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('received_confirmations >= required_confirmations');
    expect(sql).toContain('grace_ends_at <=');
    expect(sql).toContain("state = 'grace'");
  });

  it('returns 0 when nothing is due', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(resolveElapsedGrace({ transition: vi.fn() } as never, new Date())).resolves.toBe(0);
  });

  it('a racing row does not abort the rest of the sweep', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'a', owner_id: 'o', trigger_type: 'emergency', version: 1, received_confirmations: 1, required_confirmations: 1 },
        { id: 'b', owner_id: 'o', trigger_type: 'emergency', version: 1, received_confirmations: 1, required_confirmations: 1 },
      ],
      rowCount: 2,
    } as never);
    const machine = {
      transition: vi.fn().mockRejectedValueOnce(new Error('CAS mismatch')).mockResolvedValueOnce({} as never),
    };

    await expect(resolveElapsedGrace(machine as never, new Date())).resolves.toBe(1);
  });

  /*
    🔴 A FAILED RELEASE LEFT NO TRACE AT ALL. The catch here read "a concurrent
    writer moved the row; the next sweep re-evaluates it" and did nothing else —
    no counter, no log line. That reasoning holds for a lost CAS race, and for
    NOTHING ELSE: a schema change, a bad deploy of state-machine.ts, OCC
    exhaustion on every row, all landed in the same silent branch, hourly,
    forever. Meanwhile `recordSchedulerRun` wrote a healthy row, because it only
    ever carried the ARMED→PENDING counters.

    `getSchedulerHealth` now derives the stuck rows from the database and is the
    alarm. This is the other half: the moment of failure, in the log, with the
    row id, so the operator reading the alarm can find out WHY rather than only
    that. A sweep whose every release failed must not look like a quiet one.
  */
  it('writes the failure to stderr instead of swallowing it silently', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'rs-boom', owner_id: 'o', trigger_type: 'emergency', version: 1, received_confirmations: 1, required_confirmations: 1 },
      ],
      rowCount: 1,
    } as never);
    const machine = { transition: vi.fn().mockRejectedValue(new Error('CAS mismatch')) };
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await expect(resolveElapsedGrace(machine as never, new Date())).resolves.toBe(0);

    const written = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('rs-boom');
    expect(written).toContain('CAS mismatch');
    stderr.mockRestore();
  });
});

/**
 * 🔴 A SEEDED ACCOUNT WOULD HAVE PERFORMED A REAL RELEASE, unattended.
 *
 * Measured on production 2026-08-13: `demo@relay.test` is active, holds two
 * ARMED release_states and a 30-day interval, and was last active that day — so
 * around 2026-09-12 the hourly sweep would have armed both triggers and mailed
 * its verifiers. Nobody could have stopped it: a demo account has no credential,
 * so no owner exists to check in and reverse the false alarm.
 *
 * The exclusion is structural, not a data cleanup, because the seed can be run
 * again at any time and a fixture must never be able to drive the release path
 * on a schedule. `/api/demo/simulate` remains the way a demo advances, which is
 * explicit and driven by a person who meant it.
 */
describe('the sweep never fires a seeded account', () => {
  it('asks the database to exclude demo accounts rather than filtering afterwards', async () => {
    let usersSql = '';
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) {
        usersSql = sql;
        return qResult([]);
      }
      return qResult([]);
    });

    await runHeartbeatSweep({ transition: vi.fn() } as never, { sleep: async () => {} });

    /*
      Asserted on the QUERY, not on the result. A post-hoc filter in JS would
      still have loaded every demo owner and would drift the moment somebody
      adds a second caller; the column is in the WHERE clause so there is one
      place the rule lives and the database enforces it.
    */
    expect(usersSql).toContain('is_demo_account = false');
  });

  it('still sweeps ordinary owners', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return qResult([{ id: 'owner-1' }]);
      if (sql.includes("state = 'armed'")) return qResult([{ id: 'rs-1', trigger_type: 'emergency', version: '0' }]);
      return qResult([]);
    });
    const transition = vi
      .fn()
      .mockResolvedValueOnce({ id: 'rs-1', version: 1 } as never)
      .mockResolvedValueOnce({ id: 'rs-1', version: 2 } as never);

    const res = await runHeartbeatSweep({ transition } as never, { sleep: async () => {} });
    expect(res).toEqual({ evaluated: 1, transitioned: 1, failures: 0 });
  });
});


/**
 * 🔴 THE DEAD-MAN'S SWITCH USED TO ARM IN TOTAL SILENCE. A header comment
 * claimed the Req 4.4 owner alert was "wired in the notification layer"; it had
 * ZERO production callers, and the Req 6.2 verifier notice fired only on the
 * MANUAL initiate path. So the product's flagship scenario — the owner stops
 * checking in — armed the release and told nobody: no nudge to an owner who
 * might just be on holiday, no notice to the verifiers whose confirmations now
 * gate everything. Quorum sat at 0/N with nobody knowing a question existed.
 */
describe('the sweep rings the bell after it arms', () => {
  function sweepFixture(transitionOk: boolean) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users'))
        return qResult([{ id: 'owner-1', email: 'owner@example.com' }]);
      if (sql.includes("state = 'armed'"))
        return qResult([{ id: 'rs-1', trigger_type: 'emergency', version: '0' }]);
      return qResult([]);
    });
    const transition = transitionOk
      ? vi
          .fn()
          .mockResolvedValueOnce({ id: 'rs-1', version: 1 } as never)
          .mockResolvedValueOnce({ id: 'rs-1', version: 2 } as never)
      : vi.fn().mockRejectedValue(new Error('conflict'));
    return transition;
  }

  it('notifies the owner AND the verifiers after a successful arm', async () => {
    const transition = sweepFixture(true);
    await runHeartbeatSweep({ transition } as never, { sleep: async () => {} });

    expect(notifyOwnerTriggerPending).toHaveBeenCalledWith('owner@example.com', 'emergency');
    /*
      The WHOLE contact, including `email_secondary`. This sweep is one of three
      callers that used to rebuild it inline as `{ id, name, email }` — which
      selected a verifier's backup address from the database and threw it away
      one line before the send, on the path a release actually takes. The field
      is asserted here, null and all, so dropping it fails rather than passing
      quietly.
    */
    expect(notifyVerifiersForTrigger).toHaveBeenCalledWith(
      [{ id: 'v1', name: 'Dr. Chen', email: 'chen@example.com', email_secondary: null }],
      'emergency',
      'rs-1',
      'owner-1',
    );
  });

  it('sends NOTHING when the arm failed — no mail about a transition that did not happen', async () => {
    const transition = sweepFixture(false);
    await runHeartbeatSweep({ transition } as never, { sleep: async () => {} });

    expect(notifyOwnerTriggerPending).not.toHaveBeenCalled();
    expect(notifyVerifiersForTrigger).not.toHaveBeenCalled();
  });

  it('a mail failure does not fail the sweep — the next owner is still processed', async () => {
    vi.mocked(notifyOwnerTriggerPending).mockRejectedValueOnce(new Error('resend down'));
    const transition = sweepFixture(true);

    const res = await runHeartbeatSweep({ transition } as never, { sleep: async () => {} });

    // The transition still counts; the failure went to stderr, not the caller.
    expect(res.transitioned).toBe(1);
    expect(res.failures).toBe(0);
  });
});
