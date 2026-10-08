/**
 * Are the scheduled monitors actually running?
 *
 * Pure verdict logic, so every rule is provable without a network call — the
 * shape `iam-wall.ts`, `kms-wall.ts` and `stripe-wall.ts` established.
 * `scripts/check-cadence.ts` supplies the live half.
 *
 * 🔴 WHY THIS EXISTS. On 2026-08-29 the production canary ran **4 times** against
 * a designed 96, and the scheduler monitor 4 against 48. That is not a tuning
 * problem, it is the monitoring being absent: the canary's whole purpose is to
 * catch a broken deploy from outside within minutes, and at 4 runs a day the
 * detection window is six hours. Nothing reported this. It was found by a person
 * running a query, twice — first on 2026-08-27, then again on 2026-08-29 —
 * which is the exact failure mode the canary itself was built to end.
 *
 * ⚠️ AN ABSENCE ALARM WHOSE OWN SCHEDULE IS ABSENT CANNOT WORK, and that is why
 * this watcher runs DAILY rather than often. See MEASURED_2026_08_29 below for
 * the numbers that justify the choice: every DAILY workflow delivered 100% on
 * precisely the days the high-frequency ones collapsed to about 3%. So the
 * reliable tier is used to watch the unreliable one. That is not a general claim
 * that GitHub schedules are dependable — it is the narrow, measured claim that
 * daily ones are, on this repo, right now.
 *
 * 🔴 IT DOES NOT CLOSE B12. This watcher lives inside the thing it watches: if
 * GitHub Actions stops entirely, it stops too and reports nothing. What it does
 * catch is the failure that actually happened — a SELECTIVE collapse of the
 * frequent schedules while the daily ones kept running — and it would have
 * caught that one on day one. An off-GitHub heartbeat is still the real answer
 * (`deferred.the-alarms-live-inside-the-thing-they-watch`).
 *
 * ⚠️ Cron expressions appear in line comments below rather than in this block,
 * because a slash-star comment cannot contain the characters that end one and
 * every cron here begins with them.
 *
 * Feature: relay-h0-mvp
 * Requirements: B11 (measurement), B12.i (the interim alarm)
 */

/**
 * Scheduled runs per day, measured 2026-08-29 over 2026-08-24..29, in order.
 *
 * Recorded as data rather than prose because it is the entire justification for
 * the floor, and a reader should be able to re-derive it:
 *   gh api "repos/sgharlow/relay/actions/workflows/<file>/runs?per_page=100" \
 *     --paginate --jq '.workflow_runs[] | select(.event=="schedule") | .created_at' \
 *     | cut -dT -f1 | sort | uniq -c
 */
export const MEASURED_2026_08_29 = {
  // cron: every 15 minutes  -> nominal 96/day
  'production-canary.yml': [36, 38, 24, 2, 3, 4],
  // cron: every 30 minutes  -> nominal 48/day
  'scheduler-monitor.yml': [25, 26, 17, 3, 2, 4],
  // cron: daily             -> nominal 1/day. 100% delivery through the collapse.
  'delivery-webhook-monitor.yml': [1, 1, 1, 1, 1, 1],
  'date-guards.yml': [1, 1, 1, 1, 1, 1],
  'kms-wall.yml': [1, 1, 1, 1, 1],
} as const;

/** The run events that can stand for "the monitor ran". */
export type RunEvent = 'schedule' | 'workflow_dispatch';

export const CANARY_FILE = 'production-canary.yml';

/**
 * Which canary runs count as the canary RUNNING — the ONE definition, read by
 * `scripts/check-cadence.ts` (via `WATCHED`) and by the off-GitHub heartbeat's
 * delivery half (`scripts/heartbeat-local.ts`). Two copies of this rule would
 * drift, and the drift would read as an outage or hide one.
 *
 * 🔴 WHY `workflow_dispatch` COUNTS (2026-10-08). GitHub drops sub-hourly
 * schedules (B11: ~5 of a designed 96/day), so the canary's 15-minute cadence
 * now comes from a local scheduled task on VICTUS that runs
 * `gh workflow run production-canary.yml` (task `relay-canary-dispatch`; the job
 * file and its registration are in docs/canary-dispatch.md). The cron stays as
 * redundancy. A healthy day is therefore mostly DISPATCH runs, and
 * counting `schedule` alone would read a healthy canary as collapsed.
 *
 * ⚠️ WHAT THIS GIVES UP. A manual dispatch counts too, so a day of hand-run
 * dispatches could mask a dead dispatcher. It would take 24 of them in a day to
 * reach the floor, which is not a plausible accident; the trade is stated here
 * rather than discovered. If the dispatcher dies, the canary falls back to the
 * cron's ~5/day and this wall goes red, which is the right answer.
 */
export const CANARY_COUNTED_EVENTS: readonly RunEvent[] = ['schedule', 'workflow_dispatch'];

/** Runs of `events` created at or after `since`. Anything else — a push run, an unknown event — is not counted. */
export function countRuns(
  runs: readonly { event?: unknown; created_at?: unknown }[],
  events: readonly RunEvent[],
  since: Date,
): number {
  const from = since.getTime();
  return runs.filter(
    (r) =>
      typeof r.event === 'string' &&
      (events as readonly string[]).includes(r.event) &&
      typeof r.created_at === 'string' &&
      Date.parse(r.created_at) >= from,
  ).length;
}

/** One workflow's designed cadence and the floor below which it is not a monitor. */
export interface WatchedSchedule {
  /** The workflow file, e.g. `production-canary.yml`. */
  file: string;
  /** Which run events count toward `observed`. */
  countedEvents: readonly RunEvent[];
  /** Runs per day the cron asks for. */
  nominalPerDay: number;
  /**
   * The fraction of nominal below which this stops being a monitor.
   *
   * 0.25 for every entry, and the number is derived rather than felt. The
   * measurement has THREE populations, not two, and pretending otherwise is how
   * a threshold ends up looking arbitrary:
   *
   *   healthy       canary 36, 38   scheduler 25, 26   (and 40–55 earlier in August)
   *   transitional  canary 24       scheduler 17       (2026-08-26, the day it turned)
   *   collapsed     canary 2, 3, 4  scheduler 2, 3, 4  (2026-08-27 onward)
   *
   * A quarter of nominal — 24/day for the canary, 12 for the scheduler monitor —
   * sits above every collapsed day and at or below every other day. So the
   * contract this floor encodes is **"at least hourly"**: 24 runs a day is a
   * one-hour detection window, which is degraded but is still a monitor. Below
   * it, the window is measured in hours and the word stops applying.
   *
   * ⚠️ 2026-08-26 landed on exactly 24 and therefore PASSES. That is deliberate
   * and it is the uncomfortable half: the alarm would not have fired on the day
   * the collapse began, only on the day after. A floor set to catch 08-26 would
   * sit inside the healthy population and fire on ordinary days.
   *
   * ⚠️ GitHub has NEVER delivered 100% of a high-frequency schedule on this
   * repo — the best day on record is 57% of nominal. A floor set near nominal
   * would have fired every day since the workflow was created and been muted
   * within a week.
   */
  floorFraction: number;
}

export interface Finding {
  file: string;
  observed: number;
  floor: number;
  nominalPerDay: number;
  detail: string;
}

/** The two high-frequency monitors. The daily ones watch themselves by being daily. */
export const WATCHED: WatchedSchedule[] = [
  { file: CANARY_FILE, countedEvents: CANARY_COUNTED_EVENTS, nominalPerDay: 96, floorFraction: 0.25 },
  // Nothing dispatches this one, so only its cron counts.
  { file: 'scheduler-monitor.yml', countedEvents: ['schedule'], nominalPerDay: 48, floorFraction: 0.25 },
];

export function floorFor(s: WatchedSchedule): number {
  return Math.floor(s.nominalPerDay * s.floorFraction);
}

/**
 * Judge one workflow's last-24h count of COUNTED runs (`countedEvents`).
 *
 * A `push` run never counts: it says nothing about whether the monitor runs on
 * its cadence. A `workflow_dispatch` run counts only where something dispatches
 * on a cadence — today the canary alone (see `CANARY_COUNTED_EVENTS`). Until
 * 2026-10-08 this counted `schedule` only, for every workflow, on the argument
 * that a busy day of manual testing could hide a dead schedule; that argument
 * still holds for the scheduler monitor, which nothing dispatches.
 */
export function judge(s: WatchedSchedule, observed: number): Finding | null {
  const floor = floorFor(s);
  if (observed >= floor) return null;

  /*
    Zero is called out separately. "Running less than it should" and "not running
    at all" have different causes and different urgencies, and one message
    covering both is how an operator reads the wrong one at 3am.
  */
  const detail =
    observed === 0
      ? 'NOT RUNNING AT ALL in the last 24h. Either the schedule was disabled (GitHub does ' +
        'this to public repos after 60 days of inactivity, and it emails first) or Actions is ' +
        'not creating the runs' +
        (s.countedEvents.includes('workflow_dispatch')
          ? ' — and the local dispatcher (VICTUS, relay-canary-dispatch) is not dispatching either.'
          : '.')
      : `ran ${observed} times in 24h against a designed ${s.nominalPerDay}. At this rate the ` +
        `detection window is about ${(24 / observed).toFixed(1)} hours, not the minutes it is ` +
        'designed for.' +
        (s.countedEvents.includes('workflow_dispatch')
          ? ' Counted: scheduled + dispatched runs — a count near the cron\'s ~5/day means the ' +
            'local dispatcher (VICTUS, relay-canary-dispatch) has stopped.'
          : '');

  return { file: s.file, observed, floor, nominalPerDay: s.nominalPerDay, detail };
}

export function judgeAll(counts: Record<string, number>): Finding[] {
  return WATCHED.map((s) => judge(s, counts[s.file] ?? 0)).filter((f): f is Finding => f !== null);
}

/**
 * The message the workflow prints. Here so it is covered by tests, and so the
 * known-defect pointer cannot drift away from the check that emits it.
 */
export function explain(findings: Finding[]): string {
  if (!findings.length) return 'Every watched schedule is delivering above its floor.';

  const lines = findings.map(
    (f) =>
      `  ${f.file}: ${f.observed} runs / 24h (floor ${f.floor}, designed ${f.nominalPerDay})\n` +
      `    ${f.detail}`,
  );

  return (
    `${findings.length} watched schedule(s) below floor:\n${lines.join('\n')}\n\n` +
    'THIS MAY NOT BE NEW. As of 2026-08-29 this is a KNOWN OPEN defect — see\n' +
    '`deferred.the-scheduled-monitors-are-collapsing` (B11) and\n' +
    '`deferred.the-alarms-live-inside-the-thing-they-watch` (B12). Check the register\n' +
    'before investigating from scratch; what would be new is a DAILY workflow appearing\n' +
    'here, or a count of zero.\n\n' +
    'What this means while it is red: production has no effective synthetic monitoring.\n' +
    'A broken deploy is caught by the next canary run, and that may be hours away.'
  );
}
