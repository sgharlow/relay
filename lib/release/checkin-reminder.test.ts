/**
 * Tests for the pre-PENDING owner reminder ladder (J5-R4).
 *
 * 🔴 THE DEFECT. A living owner who missed ONE check-in interval had their
 * verifiers asked whether they were incapacitated, with no nudge to the owner
 * first. `runHeartbeatSweep` transitioned on the FIRST overdue sweep and
 * notified afterwards; `escalation.ts` escalates when the owner goes quiet on a
 * CHALLENGE and `silence-sweep.ts` when the VERIFIERS go quiet, and neither is
 * this. Grep found no reminder sender anywhere in lib/ — while
 * `graceWindowMs`'s own comment justified a zero grace window partly on "the
 * cron fires only after the full check-in interval plus reminders". There were
 * no reminders.
 *
 * J5's preamble calls a false PENDING the fastest way to destroy trust, and it
 * is worse than an embarrassment: verifiers who receive spurious asks stop
 * answering the real one, so this degrades the assurance model itself.
 *
 * ⚠️ THE THING THAT MUST NOT REGRESS is the opposite direction. The heartbeat
 * sweep is the product's dead-man's switch. A reminder that DELAYED or
 * SUPPRESSED the ARMED → PENDING transition would be a far worse defect than the
 * one being fixed — it would mean a genuinely absent owner's family waits longer,
 * or forever. `the reminder cannot delay the transition` below is that assertion,
 * and the design it pins is structural rather than careful: the reminder sweep
 * is a separate function reading a DISJOINT set of owners (not yet overdue),
 * called after the sweep has already run.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, 4.3, 4.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../notify/email', () => ({ sendEmailBestEffort: vi.fn(async () => true) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { sendEmailBestEffort } from '../notify/email';
import { USER_SELECTABLE_TRIGGER_TYPES } from '../domain/enums';
import {
  CHECKIN_REMINDER_RUNGS,
  CHECKIN_REMINDER_ACTIONS,
  CANDIDATE_FLOOR_FRACTION,
  dueRung,
  sweepCheckinReminders,
} from './checkin-reminder';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);
const mockSend = vi.mocked(sendEmailBestEffort);

const DAY = 24 * 60 * 60 * 1000;

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// The ladder itself
// ---------------------------------------------------------------------------

describe('the ladder', () => {
  it('has at least one rung — a ladder of none is the defect, not a fix', () => {
    expect(CHECKIN_REMINDER_RUNGS.length).toBeGreaterThanOrEqual(1);
  });

  it('every rung fires strictly BEFORE the interval elapses', () => {
    // A "reminder" at or past the deadline is not a reminder; the sweep has
    // already armed by then and `notifyOwnerTriggerPending` is the message.
    for (const rung of CHECKIN_REMINDER_RUNGS) {
      expect(rung.atElapsedFraction).toBeGreaterThan(0);
      expect(rung.atElapsedFraction).toBeLessThan(1);
    }
  });

  it('gives every rung its own audit action, or two rungs share one dedupe key', () => {
    const actions = CHECKIN_REMINDER_RUNGS.map((r) => r.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect([...CHECKIN_REMINDER_ACTIONS].sort()).toEqual([...actions].sort());
  });

  it('is declared in ascending order, which the SQL floor below depends on', () => {
    const fractions = CHECKIN_REMINDER_RUNGS.map((r) => r.atElapsedFraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
  });

  it('never sits below the SQL pre-filter, which would hide owners from it entirely', () => {
    /*
      The candidate query bounds the read at a fraction of the interval so the
      sweep is not a full table scan. That bound is a LITERAL in SQL and the
      rungs are numbers here; if a rung ever drops below it, the reminder simply
      never fires for anyone and nothing else fails. This is the guard on that,
      placed where the two numbers can be compared.
    */
    const lowest = Math.min(...CHECKIN_REMINDER_RUNGS.map((r) => r.atElapsedFraction));
    expect(CANDIDATE_FLOOR_FRACTION).toBeLessThanOrEqual(lowest);
  });
});

// ---------------------------------------------------------------------------
// dueRung — the pure rule
// ---------------------------------------------------------------------------

describe('dueRung', () => {
  const interval = 30 * DAY;
  const first = CHECKIN_REMINDER_RUNGS[0];
  const last = CHECKIN_REMINDER_RUNGS[CHECKIN_REMINDER_RUNGS.length - 1];

  it('is null before any rung is reached', () => {
    expect(dueRung(first.atElapsedFraction * interval - 1, interval, [])).toBeNull();
  });

  it('returns the first rung exactly at its threshold', () => {
    expect(dueRung(first.atElapsedFraction * interval, interval, [])).toEqual(first);
  });

  it('🔴 is NULL once the owner is already overdue — the sweep owns that moment', () => {
    /*
      THE ASSERTION THIS WHOLE FILE EXISTS FOR, stated in the direction that
      matters. Past the interval the dead-man's switch fires: `runHeartbeatSweep`
      arms the trigger and `notifyOwnerTriggerPending` goes out. Returning a rung
      here would mean the product sends a "you have not checked in" nudge to an
      owner whose release has ALREADY started, which is both wrong and the first
      step towards someone deciding the nudge should come first.
    */
    expect(dueRung(interval, interval, [])).toBeNull();
    expect(dueRung(interval + DAY, interval, [])).toBeNull();
  });

  it('returns the HIGHEST rung reached, not the first — one email, not a backlog', () => {
    // A sweep that has not run for a while must not deliver every rung at once.
    expect(dueRung(last.atElapsedFraction * interval, interval, [])).toEqual(last);
  });

  it('does not fall back to a lower rung when the highest was already sent', () => {
    // Falling back would walk the ladder BACKWARDS: the owner would get the
    // gentle first notice after the final one.
    expect(dueRung(last.atElapsedFraction * interval, interval, [last.action])).toBeNull();
  });

  it('still returns the highest rung when only a LOWER one was sent', () => {
    if (CHECKIN_REMINDER_RUNGS.length < 2) return;
    expect(dueRung(last.atElapsedFraction * interval, interval, [first.action])).toEqual(last);
  });

  it('is null for a nonsense interval rather than firing on every sweep', () => {
    expect(dueRung(DAY, 0, [])).toBeNull();
    expect(dueRung(DAY, -1, [])).toBeNull();
    expect(dueRung(Number.NaN, interval, [])).toBeNull();
  });

  it('is null for a last_active_at in the future — bad data must not mail anyone', () => {
    expect(dueRung(-DAY, interval, [])).toBeNull();
  });

  it('scales with the interval rather than assuming 30 days', () => {
    // A one-day cadence and a year-long one both have to get a nudge before
    // their own deadline, which is why the rungs are fractions.
    for (const days of [1, 7, 30, 365]) {
      const ms = days * DAY;
      expect(dueRung(last.atElapsedFraction * ms, ms, [])).toEqual(last);
      expect(dueRung(0, ms, [])).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

describe('sweepCheckinReminders', () => {
  const NOW = new Date('2026-08-21T12:00:00Z');
  const INTERVAL_DAYS = 30;

  /** An owner whose elapsed time sits on the last rung. */
  function candidate(overrides: Record<string, unknown> = {}) {
    const last = CHECKIN_REMINDER_RUNGS[CHECKIN_REMINDER_RUNGS.length - 1];
    const elapsed = last.atElapsedFraction * INTERVAL_DAYS * DAY;
    return {
      id: 'owner-1',
      email: 'owner@example.com',
      checkin_interval_days: INTERVAL_DAYS,
      last_active_at: new Date(NOW.getTime() - elapsed).toISOString(),
      ...overrides,
    };
  }

  /** Routes the two reads: the candidate query, then the audit dedupe read. */
  function setup(rows: unknown[], alreadySent: string[] = []) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return qResult(rows);
      if (sql.includes('FROM audit_log')) return qResult(alreadySent.map((a) => ({ action: a })));
      return qResult([]);
    });
  }

  it('sends one reminder to an owner approaching their deadline', async () => {
    setup([candidate()]);

    await expect(sweepCheckinReminders(NOW)).resolves.toEqual(['owner-1']);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe('owner@example.com');
  });

  it('records the send so the next sweep an hour later does not repeat it', async () => {
    setup([candidate()]);
    await sweepCheckinReminders(NOW);

    const last = CHECKIN_REMINDER_RUNGS[CHECKIN_REMINDER_RUNGS.length - 1];
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][1].action).toBe(last.action);
  });

  it('does NOT repeat a rung already recorded for this check-in window', async () => {
    const last = CHECKIN_REMINDER_RUNGS[CHECKIN_REMINDER_RUNGS.length - 1];
    setup([candidate()], [last.action]);

    await expect(sweepCheckinReminders(NOW)).resolves.toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('scopes the dedupe read to activity since the owner last checked in', async () => {
    /*
      🔴 THE DETAIL THAT DECIDES WHETHER THIS WORKS AT ALL, and the reason no
      migration is needed. "Have we reminded them?" is meaningless unqualified —
      a reminder sent last month must not silence this month's. Bounding the
      audit read at `last_active_at` makes the ladder reset itself every time the
      owner checks in or signs in, because both stamp that column. A boolean
      column would have needed clearing by hand on every one of those paths.
    */
    setup([candidate()]);
    await sweepCheckinReminders(NOW);

    const auditCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('FROM audit_log'));
    expect(auditCall, 'the dedupe read was never issued').toBeTruthy();
    expect(String(auditCall![0])).toMatch(/ts\s*>\s*\$3/);
    expect((auditCall![1] as unknown[])[2]).toBe(candidate().last_active_at);
  });

  it('asks the database to exclude demo accounts rather than filtering afterwards', async () => {
    // The same guard `runHeartbeatSweep` and `sweepSilentVerifiers` carry, and
    // for the same reason: `demo@relay.test` is live in production and its
    // address cannot receive mail, so an unattended job mailing it produces hard
    // bounces on a Resend account shared with another project.
    setup([]);
    await sweepCheckinReminders(NOW);

    const usersSql = String(
      mockQuery.mock.calls.find((c) => String(c[0]).includes('FROM users'))![0],
    );
    expect(usersSql).toContain('is_demo_account = false');
  });

  it('only considers owners who are NOT yet overdue', async () => {
    /*
      Asserted on the query, because this is what makes the two sweeps disjoint.
      An owner past their interval belongs to `runHeartbeatSweep` and must never
      appear here — a "reminder" after the release has started is a second,
      contradictory message about the same event.
    */
    setup([]);
    await sweepCheckinReminders(NOW);

    const usersSql = String(
      mockQuery.mock.calls.find((c) => String(c[0]).includes('FROM users'))![0],
    );
    expect(usersSql).toMatch(/now\(\)\s*-\s*u\.last_active_at\s*<=/);
  });

  it('only nudges owners who actually have an armed, user-selectable trigger', async () => {
    /*
      The message says a release will open. That is only true if a row is armed
      AND its type is one the sweep will act on — `runHeartbeatSweep` binds
      USER_SELECTABLE_TRIGGER_TYPES in its own WHERE clause, so a legacy `estate`
      row is never armed by the schedule. Nudging its owner would be telling them
      something the product will not do, which is the exact defect the triggers
      screen's withdrawn-notice copy was corrected for twice.
    */
    setup([]);
    await sweepCheckinReminders(NOW);

    const call = mockQuery.mock.calls.find((c) => String(c[0]).includes('FROM users'))!;
    expect(String(call[0])).toMatch(/EXISTS[\s\S]*release_state[\s\S]*state = 'armed'/);
    expect(call[1]).toEqual([[...USER_SELECTABLE_TRIGGER_TYPES]]);
  });

  it('🔴 the reminder cannot delay or suppress the transition', async () => {
    /*
      THE INVARIANT. This sweep issues reads and sends mail; it holds no state
      machine, takes no transition, and writes nothing to `release_state`. It
      therefore cannot postpone ARMED → PENDING for a genuinely absent owner, and
      a future edit that tried to would have to add a write here.
    */
    setup([candidate()]);
    await sweepCheckinReminders(NOW);

    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
    }
  });

  it('does not record a send that failed, so the next sweep tries again', async () => {
    // Opposite of `reserveInviteEmail`, and deliberately: that meter bounds a
    // cost and must tick even when the send fails. This marker exists to avoid
    // repeating a message, and there is nothing to avoid repeating if nothing
    // was delivered.
    setup([candidate()]);
    mockSend.mockResolvedValueOnce(false);

    await expect(sweepCheckinReminders(NOW)).resolves.toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('one owner failing does not abort the rest of the sweep', async () => {
    setup([candidate({ id: 'owner-1' }), candidate({ id: 'owner-2', email: 'two@example.com' })]);
    mockSend.mockRejectedValueOnce(new Error('resend exploded'));
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await expect(sweepCheckinReminders(NOW)).resolves.toEqual(['owner-2']);

    const written = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('owner-1');
    expect(written).toContain('resend exploded');
    stderr.mockRestore();
  });

  it('a failed candidate read is logged and returns empty rather than failing the cron', async () => {
    /*
      It runs AFTER `recordSchedulerRun`, and this is the other half of that
      placement. The ledger's ABSENCE is the dead-man's alarm for the scheduler;
      a nudge email throwing must never be able to make the product look like its
      dead-man's switch has stopped. Logged, never silent — a swallowed failure
      is the most-cited mistake in this repo.
    */
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await expect(sweepCheckinReminders(NOW)).resolves.toEqual([]);
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('connection refused');
    stderr.mockRestore();
  });

  it('the message says what happens next and links the page that stops it', async () => {
    setup([candidate()]);
    await sweepCheckinReminders(NOW);

    const msg = mockSend.mock.calls[0][0];
    expect(msg.text).toContain('/triggers');
    // Honest about the consequence. The owner is being told a release will
    // START, not that anything has been shared — nothing has.
    expect(msg.text).toMatch(/nothing has been shared|nothing has opened/i);
    expect(msg.subject.length).toBeGreaterThan(0);
  });

  it('does not mail an owner the SQL floor let through but no rung has reached', async () => {
    /*
      🔴 THE GAP BETWEEN THE TWO NUMBERS, and the reason it must be tested rather
      than reasoned about. The candidate query reads from half-way through the
      interval (`CANDIDATE_FLOOR_FRACTION`) so it is not a full table scan; the
      first rung is later than that. Every owner in between is FETCHED and must
      not be mailed. If the rule were ever mistaken for the query — "it came back
      from the database, so it is due" — every owner would get a warning at the
      half-way mark, which for a 30-day cadence is a fortnight early.
    */
    const elapsed = CANDIDATE_FLOOR_FRACTION * INTERVAL_DAYS * DAY;
    setup([candidate({ last_active_at: new Date(NOW.getTime() - elapsed).toISOString() })]);

    await expect(sweepCheckinReminders(NOW)).resolves.toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
    // And it does not pay for a dedupe read it cannot use.
    expect(mockQuery.mock.calls.filter((c) => String(c[0]).includes('FROM audit_log'))).toEqual([]);
  });

  it('skips an owner whose email is missing rather than throwing', async () => {
    setup([candidate({ email: null })]);
    await expect(sweepCheckinReminders(NOW)).resolves.toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
