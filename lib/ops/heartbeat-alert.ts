/**
 * B12.i — when the off-GitHub heartbeat MAILS, as opposed to what it checks.
 *
 * 🔴 WHY THIS EXISTS (2026-10-08). `scripts/heartbeat-local.ts` runs every 15
 * minutes and mailed on EVERY run that had a finding. The finding it mostly has
 * is B11 — GitHub dropping the sub-hourly canary schedule, a known-open defect
 * since 2026-08-29 — so the operator got the same "delivery FAILING" sentence
 * every quarter-hour: 37 alerts in the 14.8 days to 2026-10-08, thirteen in the
 * last two. A watchdog that repeats itself gets filtered, and the filter takes
 * the PRODUCTION half with it — the half that means customers are meeting a
 * broken product. So: alert on change, not on every tick.
 *
 * THE RULES.
 *   - The problem's identity is a sorted set of `half:key` strings. Keys are
 *     stable facts (which canary checks failed; "scheduled canary stopped"),
 *     never counts or timestamps, which change every run.
 *   - New or different set → mail at once. Same set → mail again only once the
 *     reminder period has passed since the last mail (HEARTBEAT_REMIND_HOURS,
 *     default 24).
 *   - Clear → ONE "recovered" mail, once the clear has HELD for the recovery
 *     period (HEARTBEAT_RECOVERY_HOURS, default 6). The hold is measured, not
 *     felt: the delivery condition FLAPS — 16 episodes of 1-6 runs in those
 *     14.8 days, mostly ~6h apart, because one dropped-then-delivered canary run
 *     moves the 6h window count between 0 and 1. A recovered mail on the first
 *     clean tick would turn one mail per episode into two (replay: 41 → 32);
 *     a 6h hold folds the flaps together (41 → 18). The same set returning
 *     inside the hold is the same problem, not a new one. A DIFFERENT set during
 *     the hold still mails at once.
 *   - A half that could not be looked at (gh unavailable) is UNKNOWN, not clear:
 *     its keys carry over from the open alert rather than reading as resolved.
 *
 * 🔴 FAILS OPEN. Every way the state file can fail — missing, corrupt, wrong
 * shape, future-dated, unreadable, unwritable — resolves toward SENDING, never
 * toward silence, and never throws out of `alertTick`. A missing or unwritable
 * file degrades to the old every-tick behaviour, which is noisy and safe. And a
 * mail that was not accepted does not advance the state, so the next tick
 * retries it rather than believing it went.
 *
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Half = 'production' | 'delivery';

export interface HeartbeatFinding {
  half: Half;
  /** Stable identity of the problem within its half. Never a count or a time. */
  key: string;
  detail: string;
  consequence: string;
}

/** The open alert, as persisted. Absent file = no open alert. */
export interface AlertState {
  v: 1;
  problems: string[];
  firstAlertAt: string;
  lastAlertAt: string;
  /** When the problem was first seen clear, while waiting out the recovery hold. */
  clearSince: string | null;
}

export type StateRead = { kind: 'none' } | { kind: 'ok'; state: AlertState } | { kind: 'unreadable'; why: string };

/** `read` should not throw, but `alertTick` survives it if it does. `write` may throw. */
export interface StateStore {
  read(): StateRead;
  write(next: AlertState | null): void;
}

export interface AlertPolicy {
  remindHours: number;
  recoveryHours: number;
}

export interface TickDeps {
  store: StateStore;
  now(): Date;
  /** True when the provider accepted the mail. */
  send(subject: string, text: string): Promise<boolean>;
}

export type TickKind =
  | 'new'
  | 'changed'
  | 'reminder'
  | 'state-unreadable'
  | 'recovered'
  | 'suppressed-unchanged'
  | 'recovery-pending'
  | 'healthy';

export interface TickOutcome {
  kind: TickKind;
  /** A mail was attempted AND accepted. */
  sent: boolean;
  /** A mail was attempted. */
  attempted: boolean;
  nextReminderAt?: string;
  stateError?: string;
}

const H = 3600_000;
/** How far ahead of now a stored time may sit before it is distrusted (clock skew). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export const DEFAULT_POLICY: AlertPolicy = { remindHours: 24, recoveryHours: 6 };

function hoursFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Reads the two periods; a value that is not a non-negative number falls back to the default. */
export function policyFromEnv(env: Record<string, string | undefined>): AlertPolicy {
  return {
    remindHours: hoursFrom(env.HEARTBEAT_REMIND_HOURS, DEFAULT_POLICY.remindHours),
    recoveryHours: hoursFrom(env.HEARTBEAT_RECOVERY_HOURS, DEFAULT_POLICY.recoveryHours),
  };
}

/**
 * The identity of a production failure: the names of the canary checks that
 * failed, sorted. `scripts/canary.ts` prints each as `  ✗ <name> — <detail>`.
 */
export function productionKey(canaryOutput: string): string {
  const names = [...canaryOutput.matchAll(/^\s*✗ (.+?) — /gm)].map((m) => m[1].trim());
  return names.length ? [...new Set(names)].sort().join(',') : 'canary-failed-without-naming-a-check';
}

export function problemKeys(findings: HeartbeatFinding[]): string[] {
  return [...new Set(findings.map((f) => `${f.half}:${f.key}`))].sort();
}

const halfOf = (k: string) => k.slice(0, k.indexOf(':'));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const isIsoTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function validState(v: unknown): v is AlertState {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  return (
    s.v === 1 &&
    Array.isArray(s.problems) &&
    s.problems.length > 0 &&
    s.problems.every((p) => typeof p === 'string' && p.includes(':')) &&
    isIsoTime(s.firstAlertAt) &&
    isIsoTime(s.lastAlertAt) &&
    (s.clearSince === null || isIsoTime(s.clearSince))
  );
}

/** A JSON file next to the heartbeat's other state. Written atomically (tmp + rename). */
export function fileStateStore(path: string): StateStore {
  return {
    read(): StateRead {
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' };
        return { kind: 'unreadable', why: `read failed: ${(e as Error).message.slice(0, 120)}` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { kind: 'unreadable', why: 'not valid JSON' };
      }
      return validState(parsed) ? { kind: 'ok', state: parsed } : { kind: 'unreadable', why: 'not a valid alert state' };
    },
    write(next: AlertState | null): void {
      if (next === null) {
        rmSync(path, { force: true });
        return;
      }
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
      renameSync(tmp, path);
    },
  };
}

interface ComposeCtx {
  baseUrl: string;
  at: Date;
  why: 'new' | 'changed' | 'reminder' | 'state-unreadable';
  added: string[];
  cleared: string[];
  nextReminderAt: Date;
  policy: AlertPolicy;
  firstAlertAt?: string;
  unreadableWhy?: string;
}

/** The finding mail. Subject and body are the pre-2026-10-08 format plus two lines. */
export function composeFindingAlert(findings: HeartbeatFinding[], ctx: ComposeCtx): { subject: string; text: string } {
  const why =
    ctx.why === 'reminder'
      ? `Why now: reminder — unchanged since first alerted at ${ctx.firstAlertAt ?? 'an unknown time'}.`
      : ctx.why === 'changed'
        ? `Why now: the problem changed — new: ${ctx.added.join('; ') || 'none'}; cleared: ${ctx.cleared.join('; ') || 'none'}.`
        : ctx.why === 'state-unreadable'
          ? `Why now: the alert-state file could not be read (${ctx.unreadableWhy ?? 'unknown'}), so this alerts rather than risk staying silent.`
          : 'Why now: a new problem (no alert was open).';
  const next =
    `Next reminder: ${ctx.nextReminderAt.toISOString()} if nothing changes (every ${ctx.policy.remindHours}h while ` +
    `unchanged). A different problem alerts at once; one "recovered" mail follows once this has been clear ` +
    `for ${ctx.policy.recoveryHours}h.`;
  const text =
    `The off-GitHub heartbeat (B12.i) found ${findings.length} problem(s) at ` +
    `${ctx.at.toISOString()}.\n\nThis alert was sent by the LOCAL watchdog on the operator's ` +
    `machine, deliberately outside GitHub Actions, because the GitHub-scheduled canary is being ` +
    `dropped (~6 runs/day against a designed 96).\n\n` +
    findings.map((f) => `── ${f.half.toUpperCase()}\n${f.detail}\n\n→ ${f.consequence}`).join('\n\n') +
    `\n\n${why}\n${next}` +
    `\n\nProbed: ${ctx.baseUrl}\n`;
  return { subject: `[relay] heartbeat: ${findings.map((f) => f.half).join(' + ')} FAILING`, text };
}

function composeRecovered(prev: AlertState, at: Date, policy: AlertPolicy, baseUrl: string): { subject: string; text: string } {
  const text =
    `The off-GitHub heartbeat (B12.i) reports that the problem(s) it alerted on have been clear for at ` +
    `least ${policy.recoveryHours}h, as of ${at.toISOString()}:\n\n` +
    prev.problems.map((p) => `  • ${p}`).join('\n') +
    `\n\nFirst alerted ${prev.firstAlertAt}; last alerted ${prev.lastAlertAt}; clear since ${prev.clearSince ?? at.toISOString()}.\n` +
    `No further mail unless a problem returns.\n\nProbed: ${baseUrl}\n`;
  return { subject: '[relay] heartbeat: recovered', text };
}

/**
 * One heartbeat tick's mail decision: reads the open alert, decides, sends,
 * and records what was sent. Never throws for a state-file failure.
 */
export async function alertTick(
  findings: HeartbeatFinding[],
  deps: TickDeps,
  ctx: { baseUrl: string; policy: AlertPolicy; unknownHalves?: Half[] },
): Promise<TickOutcome> {
  const now = deps.now();
  const nowMs = now.getTime();
  const { policy } = ctx;

  let read: StateRead;
  try {
    read = deps.store.read();
  } catch (e) {
    read = { kind: 'unreadable', why: `read threw: ${(e as Error).message.slice(0, 120)}` };
  }
  // A stored time in the future would hold every reminder until that date. Distrust it.
  if (
    read.kind === 'ok' &&
    [read.state.firstAlertAt, read.state.lastAlertAt, read.state.clearSince].some(
      (t) => t !== null && Date.parse(t) > nowMs + FUTURE_TOLERANCE_MS,
    )
  ) {
    read = { kind: 'unreadable', why: 'a stored time is in the future' };
  }
  const prev = read.kind === 'ok' ? read.state : null;

  let stateError: string | undefined;
  const save = (next: AlertState | null) => {
    try {
      deps.store.write(next);
    } catch (e) {
      stateError = `state write failed: ${(e as Error).message.slice(0, 160)}`;
    }
  };

  let keys = problemKeys(findings);
  // Unknown is not clear: carry the open alert's keys for a half nobody could look at.
  if (prev && findings.length && ctx.unknownHalves?.length) {
    const carried = prev.problems.filter((p) => ctx.unknownHalves!.includes(halfOf(p) as Half));
    keys = [...new Set([...keys, ...carried])].sort();
  }

  // ── HEALTHY ──────────────────────────────────────────────────────────────
  if (findings.length === 0) {
    if (read.kind === 'unreadable') {
      // Nothing to alert on; a recovered mail would be a guess. Clear the bad file.
      save(null);
      return { kind: 'healthy', sent: false, attempted: false, stateError };
    }
    if (!prev) return { kind: 'healthy', sent: false, attempted: false };
    const clearSince = prev.clearSince ?? now.toISOString();
    if (nowMs - Date.parse(clearSince) >= policy.recoveryHours * H) {
      const { subject, text } = composeRecovered({ ...prev, clearSince }, now, policy, ctx.baseUrl);
      const sent = await deps.send(subject, text);
      // Not accepted → keep the state, so the next tick tries again.
      save(sent ? null : { ...prev, clearSince });
      return { kind: 'recovered', sent, attempted: true, stateError };
    }
    if (prev.clearSince !== clearSince) save({ ...prev, clearSince });
    return { kind: 'recovery-pending', sent: false, attempted: false, stateError };
  }

  // ── A FINDING ────────────────────────────────────────────────────────────
  let why: 'new' | 'changed' | 'reminder' | 'state-unreadable' | null;
  if (read.kind === 'unreadable') why = 'state-unreadable';
  else if (!prev) why = 'new';
  else if (!sameSet(prev.problems, keys)) why = 'changed';
  else if (nowMs - Date.parse(prev.lastAlertAt) >= policy.remindHours * H) why = 'reminder';
  else why = null;

  if (why === null) {
    // Same problem, inside the reminder period. A pending recovery is cancelled.
    const held = prev!;
    if (held.clearSince !== null) save({ ...held, clearSince: null });
    return {
      kind: 'suppressed-unchanged',
      sent: false,
      attempted: false,
      nextReminderAt: new Date(Date.parse(held.lastAlertAt) + policy.remindHours * H).toISOString(),
      stateError,
    };
  }

  const nextReminderAt = new Date(nowMs + policy.remindHours * H);
  const { subject, text } = composeFindingAlert(findings, {
    baseUrl: ctx.baseUrl,
    at: now,
    why,
    added: prev ? keys.filter((k) => !prev.problems.includes(k)) : [],
    cleared: prev ? prev.problems.filter((k) => !keys.includes(k)) : [],
    nextReminderAt,
    policy,
    firstAlertAt: prev?.firstAlertAt,
    unreadableWhy: read.kind === 'unreadable' ? read.why : undefined,
  });
  const sent = await deps.send(subject, text);
  if (sent) {
    save({
      v: 1,
      problems: keys,
      firstAlertAt: why === 'reminder' && prev ? prev.firstAlertAt : now.toISOString(),
      lastAlertAt: now.toISOString(),
      clearSince: null,
    });
  }
  return { kind: why, sent, attempted: true, nextReminderAt: sent ? nextReminderAt.toISOString() : undefined, stateError };
}
