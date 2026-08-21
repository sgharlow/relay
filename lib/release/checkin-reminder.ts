/**
 * The nudge an owner gets BEFORE their dead-man's switch fires (J5-R4).
 *
 * 🔴 THE DEFECT THIS CLOSES. A living owner who missed ONE check-in interval had
 * their verifiers asked whether they were incapacitated, with nothing said to
 * the owner first. `runHeartbeatSweep` transitions ARMED → PENDING on the FIRST
 * overdue sweep and notifies afterwards, so the entire warning an owner received
 * was the message telling them it had already started.
 *
 * The product had escalation ladders in both of the other directions and none in
 * this one. `escalation.ts` handles the OWNER going quiet on a challenge;
 * `silence-sweep.ts` and `quiet-channel.ts` handle the VERIFIER channel going
 * quiet. Nothing handled the ordinary case the whole cadence exists for — a
 * person on holiday, in hospital, or simply not opening an app for a fortnight.
 * `triggers.ts` even justified its zero grace window partly on the cron firing
 * "only after the full check-in interval PLUS REMINDERS"; grep found no reminder
 * sender anywhere in `lib/`, and that clause has since been corrected.
 *
 * WHY IT IS NOT MERELY AN INCONVENIENCE. J5's preamble calls a false PENDING the
 * fastest way to destroy trust, and the cost is not embarrassment: verifiers who
 * are asked spurious questions stop answering, and the one that matters arrives
 * in a channel people have learned to ignore. A false alarm is cheap in database
 * terms and expensive in the only currency this product runs on.
 *
 * ⚠️⚠️ WHAT THIS DELIBERATELY DOES NOT DO — read before editing.
 *
 * It does not delay, gate, or suppress ARMED → PENDING. The heartbeat sweep is
 * the dead-man's switch; a reminder that held it back would mean a genuinely
 * absent owner's family waits longer, which is a worse defect than the one being
 * fixed here, and it would be invisible until the day it mattered.
 *
 * That is enforced by SHAPE, not by care. This module holds no state machine and
 * writes nothing to `release_state` — it issues two reads and sends an email. It
 * runs as its own sweep over a set of owners that is DISJOINT from the one
 * `runHeartbeatSweep` reads: this one takes owners who are *approaching* their
 * interval, that one takes owners who have *passed* it. No owner can be in both
 * on the same run, so ordering between them cannot matter.
 *
 * NO MIGRATION. "Has this owner been reminded?" is answered from `audit_log`,
 * the way `reserveInviteEmail` meters invitation mail and `sweepSilentVerifiers`
 * de-duplicates its silence notice. The read is bounded at `last_active_at`,
 * which is what makes the ladder reset itself: check-in stamps that column
 * (`processCheckin`) and so does signing in (`upsert-user.ts`, `liveness.ts`), so
 * the moment an owner shows any sign of life every rung falls out of the window
 * and the next cycle starts fresh. A boolean column would have had to be cleared
 * by hand on all three of those paths, and the one somebody forgot would silence
 * the ladder permanently for that owner.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, 4.3, 4.4
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { sendEmailBestEffort } from '../notify/email';
import { appUrl } from '../app-url';
import { USER_SELECTABLE_TRIGGER_TYPES } from '../domain/enums';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export interface ReminderRung {
  /** Short name, for the audit detail and for reading a test failure. */
  readonly key: string;
  /**
   * How far through the check-in interval this rung becomes due, as a fraction.
   * Strictly between 0 and 1: at 1 the owner is overdue and the sweep owns them.
   */
  readonly atElapsedFraction: number;
  /** The audit action recording this rung. Also its dedupe key. */
  readonly action: string;
  readonly subject: string;
  /** The opening line, which is the only part that differs in tone by rung. */
  readonly lead: string;
}

/**
 * Two rungs, expressed as fractions of the owner's own interval.
 *
 * FRACTIONS RATHER THAN DAYS, because `checkin_interval_days` is anything from 1
 * to 365 and a fixed "three days before" is either the whole notice period or an
 * invisible sliver depending on which owner you are. At the 30-day default these
 * land about a week out and about three days out; at a one-day cadence, about
 * six hours and about two. The cron runs hourly, so even the tightest of those
 * has runs to spare.
 *
 * TWO IS A JUDGEMENT, NOT A MEASUREMENT, and it is written here rather than
 * buried in the sweep so it can be argued with — the same stance
 * `VERIFIER_SILENCE_WINDOW_MS` takes about its own number. One notice is a
 * message that can be missed; three is the beginning of the nagging that makes
 * people filter a sender, and the message this product most needs to survive the
 * filter is the one that comes AFTER these.
 *
 * ⚠️ ASCENDING ORDER IS LOAD-BEARING for readability only — `dueRung` picks the
 * highest reached by comparison, not by position, so a mis-ordered list cannot
 * silently pick the wrong rung. `checkin-reminder.test.ts` pins the order anyway,
 * because the file reads as a ladder and should stay one.
 */
export const CHECKIN_REMINDER_RUNGS: readonly ReminderRung[] = [
  {
    key: 'first',
    atElapsedFraction: 0.75,
    action: 'owner_checkin_reminder_first',
    subject: 'Relay has not heard from you',
    lead: 'This is an early nudge, with time to spare.',
  },
  {
    key: 'final',
    atElapsedFraction: 0.9,
    action: 'owner_checkin_reminder_final',
    subject: 'Last reminder before Relay starts asking the people you named',
    lead: 'This is the last reminder before Relay acts.',
  },
];

/** Every action this module writes. The dedupe read binds exactly this list. */
export const CHECKIN_REMINDER_ACTIONS: readonly string[] = CHECKIN_REMINDER_RUNGS.map(
  (r) => r.action,
);

/**
 * How far into the interval the candidate SQL starts looking, as a fraction.
 *
 * The query bounds its read so the sweep is not a full scan of `users`, and that
 * bound is a literal in the statement (`/ 2`) rather than a parameter — interval
 * arithmetic with a bound parameter is one more operator to be wrong about on a
 * database this repo cannot exercise locally, for a saving that is invisible.
 *
 * ⚠️ IT MUST STAY AT OR BELOW THE LOWEST RUNG. If a rung ever drops beneath it,
 * the owners that rung is for are never READ, so the reminder silently stops
 * existing for them and nothing else fails. `checkin-reminder.test.ts` compares
 * the two, which is the only place they can be compared.
 */
export const CANDIDATE_FLOOR_FRACTION = 0.5;

/**
 * Which rung, if any, is due for an owner this far into their interval.
 *
 * Pure, so the rule can be read without running anything and tested without a
 * database — the shape `isChallengeLapsed` and `isVerifierSilence` already
 * establish for the other time-based rules in this subsystem.
 *
 * Returns the HIGHEST rung reached, never a backlog: a sweep that has not run
 * for a day must send one message, not a sequence of increasingly urgent ones
 * arriving together. And if that highest rung has already been sent it returns
 * null rather than falling back to a lower one, which would walk the ladder
 * backwards and deliver the gentle notice after the final one.
 */
export function dueRung(
  elapsedMs: number,
  intervalMs: number,
  alreadySent: readonly string[],
): ReminderRung | null {
  // Bad data never mails anybody. A non-positive interval, an unparseable
  // timestamp, or a `last_active_at` in the future all mean "we do not know how
  // long this has been", and not knowing is not grounds for telling somebody
  // their vault is about to open — the same rule `isVerifierSilence` applies.
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(intervalMs)) return null;
  if (intervalMs <= 0 || elapsedMs < 0) return null;

  // 🔴 THE LINE THAT KEEPS THE DEAD-MAN'S SWITCH INTACT. At or past the interval
  // the owner is overdue: `runHeartbeatSweep` arms the trigger and
  // `notifyOwnerTriggerPending` is the message they get. A rung here would be a
  // second, contradictory notice about the same event — and would be the first
  // step towards somebody deciding the nudge ought to come first instead.
  if (elapsedMs >= intervalMs) return null;

  let highest: ReminderRung | null = null;
  for (const rung of CHECKIN_REMINDER_RUNGS) {
    if (elapsedMs < rung.atElapsedFraction * intervalMs) continue;
    if (highest === null || rung.atElapsedFraction > highest.atElapsedFraction) highest = rung;
  }

  if (highest === null) return null;
  return alreadySent.includes(highest.action) ? null : highest;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface CandidateRow {
  id: string;
  email: string | null;
  checkin_interval_days: number;
  last_active_at: string;
}

/**
 * Owners far enough into their interval to be worth a reminder, and not yet
 * overdue.
 *
 * THREE PREDICATES ARE IN THE WHERE CLAUSE ON PURPOSE, and each has a sibling
 * elsewhere that records why a post-hoc filter in JS is not good enough:
 *
 *  - `is_demo_account = false` — `runHeartbeatSweep`'s header states the whole
 *    finding. `demo@relay.test` is live in production, its contacts sit in
 *    reserved domains that cannot receive mail, and this job runs hourly with
 *    nobody watching. A row that must never be mailed should not be fetched.
 *  - not yet overdue — this is what makes this sweep and the heartbeat sweep
 *    disjoint. Enforced by the database rather than by remembering.
 *  - an ARMED row of a type the schedule will actually act on — the message says
 *    a release will start, and that is only true if `runHeartbeatSweep` would
 *    start one. It binds `USER_SELECTABLE_TRIGGER_TYPES` in its own read, so a
 *    legacy `estate` row is never armed by the schedule; nudging its owner would
 *    be promising something the product will not do. The triggers screen has had
 *    that exact copy defect twice.
 *
 * `now()` here is the database's clock and the rung arithmetic below uses the
 * caller's. The gap is milliseconds against thresholds measured in days, and the
 * JS rule is the authoritative one — this query only narrows what is read.
 */
const CANDIDATE_SQL = `
  SELECT u.id, u.email, u.checkin_interval_days, u.last_active_at::text AS last_active_at
    FROM users u
   WHERE u.status = 'active'
     AND u.is_demo_account = false
     AND u.checkin_interval_days > 0
     AND now() - u.last_active_at <= (u.checkin_interval_days * INTERVAL '1 day')
     AND now() - u.last_active_at >= (u.checkin_interval_days * INTERVAL '1 day') / 2
     AND EXISTS (
           SELECT 1 FROM release_state rs
            WHERE rs.owner_id = u.id
              AND rs.state = 'armed'
              AND rs.trigger_type = ANY($1)
         )`;

/** Which rungs this owner has already been sent since they were last active. */
async function rungsSentThisWindow(ownerId: string, lastActiveAt: string): Promise<string[]> {
  const r = await query<{ action: string }>(
    `SELECT action FROM audit_log
      WHERE owner_id = $1 AND action = ANY($2) AND ts > $3`,
    [ownerId, [...CHECKIN_REMINDER_ACTIONS], lastActiveAt],
  );
  return r.rows.map((row) => row.action);
}

function reminderBody(rung: ReminderRung, elapsedDays: number, dueAt: Date): string {
  const due = dueAt.toISOString().slice(0, 10);
  return (
    `${rung.lead}\n\n` +
    `It has been ${elapsedDays} ${elapsedDays === 1 ? 'day' : 'days'} since Relay last saw any ` +
    `sign of you. If it still has not heard from you on ${due}, it will start asking the people ` +
    `you named whether you are all right — and if enough of them agree, the access you arranged ` +
    `opens to the people you chose.\n\n` +
    `Nothing has opened and nothing has been shared. Signing in is enough on its own; there is ` +
    `also a button:\n\n` +
    `    ${appUrl()}/triggers\n\n` +
    `If you are away and this is expected, you can change how long Relay waits on that same page.\n`
  );
}

/**
 * Sends the due reminder to every owner approaching their check-in deadline.
 *
 * Returns the owner ids actually reminded. One owner's failure never aborts the
 * sweep — these are independent families, and a mail problem for one is not a
 * reason to leave the rest unwarned.
 *
 * ⚠️ IT NEVER THROWS, and that is a placement decision rather than a swallow.
 * The cron route calls this AFTER `recordSchedulerRun`, whose ABSENCE is the
 * dead-man's alarm for the scheduler itself: a nudge email failing must not be
 * able to make the product look as though its dead-man's switch has stopped.
 * Every failure is written to stderr with the owner and the error, because a
 * sweep whose every send failed must not look like a quiet one.
 */
export async function sweepCheckinReminders(now: Date = new Date()): Promise<string[]> {
  const reminded: string[] = [];

  let candidates: CandidateRow[];
  try {
    const r = await query<CandidateRow>(CANDIDATE_SQL, [[...USER_SELECTABLE_TRIGGER_TYPES]]);
    candidates = r.rows;
  } catch (err) {
    process.stderr.write(`[checkin-reminder] candidate read failed: ${String(err)}\n`);
    return reminded;
  }

  for (const owner of candidates) {
    try {
      if (!owner.email) continue;

      const lastActive = new Date(owner.last_active_at).getTime();
      const intervalMs = owner.checkin_interval_days * MS_PER_DAY;
      const elapsedMs = now.getTime() - lastActive;

      /*
        The rule decides, not the query. `CANDIDATE_SQL` starts reading half-way
        through the interval and the first rung is later than that, so most rows
        it returns are not due yet — asking the audit log about them buys a query
        per owner per hour and answers nothing. Checking with an empty
        `alreadySent` is exactly "has any rung been reached at all".

        ⚠️ It is also the line that stops the SQL floor being mistaken for the
        rule. If this fell through to sending, every owner would be warned at the
        half-way mark — a fortnight early on the 30-day default.
      */
      if (dueRung(elapsedMs, intervalMs, []) === null) continue;

      const sent = await rungsSentThisWindow(owner.id, owner.last_active_at);
      const rung = dueRung(elapsedMs, intervalMs, sent);
      if (!rung) continue;

      const elapsedDays = Math.max(1, Math.floor(elapsedMs / MS_PER_DAY));
      const delivered = await sendEmailBestEffort({
        to: owner.email,
        subject: rung.subject,
        text: reminderBody(rung, elapsedDays, new Date(lastActive + intervalMs)),
      });

      /*
        Written AFTER the send, and only on success — the opposite way round from
        `reserveInviteEmail`, for the reason `sweepSilentVerifiers` already
        records. That meter exists to bound a cost, so it must tick even when the
        send then fails. This marker exists to avoid repeating a message; if
        nothing was delivered there is nothing to avoid repeating, and the next
        sweep should try again rather than record silence as handled.
      */
      if (!delivered) continue;

      await writeAuditEntry(owner.id, {
        actor: 'system:checkin_reminder',
        action: rung.action,
        entity: 'user',
        detail: { rung: rung.key, elapsedDays, intervalDays: owner.checkin_interval_days },
      });

      reminded.push(owner.id);
    } catch (err) {
      process.stderr.write(
        `[checkin-reminder] reminder failed for owner ${owner.id}: ${String(err)}\n`,
      );
    }
  }

  return reminded;
}
