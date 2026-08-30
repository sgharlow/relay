/**
 * Did a walk leave rows on production, and is anybody looking?
 *
 * 🔴 THE GAP THIS CLOSES, IN THE REGISTER'S OWN WORDS. `deferred
 * .verify-live-cannot-enter-ci` (D4) has been open since 2026-08-18, blocked on
 * a separate test cluster — infrastructure with a cost attached, Steve's call.
 * But that entry also names a SECOND finding, and says plainly which one
 * matters more:
 *
 *   "🔑 THE REAL GAP IT EXPOSES: a separate test cluster would make the walks
 *    safe, but it would NOT make an abandoned row visible. A count of disposable
 *    accounts older than a day, checked somewhere, is a smaller and more useful
 *    thing than the cluster — and nothing in this repo does it."
 *
 * `scripts/disposable-sweep.ts` produces that count and has since 2026-08-19.
 * Nothing schedules it. It is a command a person has to remember, which is the
 * same weakness that put the walks it watches out of CI in the first place — and
 * on 2026-08-30 it was reporting a FAIL that nothing had seen.
 *
 * ⚠️ WHY THIS IS A PROBE AND NOT A GITHUB JOB, which is what the plan first
 * said. Scheduling the sweep in Actions needs a database credential on a runner.
 * `.env.ro` is a STATIC access-key pair, so putting it in CI is D21 — Steve's,
 * a credential decision — and minting an OIDC role for `relay_ro` instead is an
 * IAM change, also Steve's, and carries the recursion `docs/
 * iam-wall-oidc-role-proposal.md` names: a new principal the IAM wall does not
 * watch. Either route waits on a person.
 *
 * The application already holds the credential. So the question is answered
 * where the answer already is, and exposed as counts on a public probe — exactly
 * the contract `/api/health/scheduler`, `/api/health/delivery-webhook` and
 * `/api/health/reminders` already keep. A monitor then reaches it holding
 * NOTHING, which is the property that stops the watcher sharing fate with the
 * watched. No new credential, no new principal, no infrastructure change.
 *
 * ⚠️ WHAT IT ALARMS ON, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * STALE DISPOSABLE ACCOUNTS alarm. That is the leak: a walk that dies mid-way,
 * or a fixture with no close step, leaves reserved-domain rows on the production
 * cluster and REPORTS SUCCESS. It has happened at least twice, and both times it
 * was found by a person looking, after an unrelated question.
 *
 * DANGLING ROWS ARE COUNTED AGAINST A BASELINE, and do not alarm at today's
 * number. There are {@link DANGLING_BASELINE} of them, they are residue of a
 * hand-written `DELETE FROM users` rather than of any walk, and their
 * disposition is an OPEN RULING (D20) that this file has no business
 * pre-empting. A probe that goes red on its first run and stays red until
 * somebody makes an unrelated decision is a probe that teaches an operator to
 * ignore it — the failure `disposable-sweep.ts` already made once with
 * `audit_log` and documented at length. What IS worth alarming on is the number
 * GROWING, because that is what a new leak looks like from here.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the countable half), CC9
 */

import { query } from '../db/connection';

import {
  RESERVED_TLDS,
  OWNER_COLUMNS,
  RETAINED_BY_DESIGN,
  danglingLabel,
  judge,
  staleCount,
  type DisposableRow,
} from './disposable-accounts';

/**
 * "Older than a day", which is D4's own phrasing. A walk in flight is not a
 * leak, and a threshold under the length of a walk would alarm on every run.
 */
export const MAX_AGE_HOURS = 24;

/**
 * Dangling rows present on 2026-08-30, measured with `npm run verify:orphans`:
 * `verifier_codes.owner_id` 17, `break_glass_codes.owner_id` 10,
 * `recipient_codes.owner_id` 1.
 *
 * ⚠️ THIS IS A RECORD OF A KNOWN STATE, NOT A TOLERANCE, and the distinction is
 * the reason it is a named constant with a date rather than a magic number. The
 * rows are historical residue of a hand-written `DELETE FROM users` that did not
 * run the cascade; `verify:orphans` fails on them today and should; their
 * disposition is Steve's open ruling (D20, "twice confirmed as inert residue").
 *
 * The probe's job is to notice something NEW. Anything above this number is new.
 *
 * ⚠️ IF THE RULING PURGES THEM, LOWER THIS TO 0 IN THE SAME COMMIT. A baseline
 * left above the real count is a blind spot exactly the size of the difference —
 * which is how a tolerance becomes a place for a leak to hide.
 */
export const DANGLING_BASELINE = 28;

export interface OrphanHealth {
  healthy: boolean;
  /** Reserved-domain accounts on the cluster right now. */
  disposableAccounts: number;
  /** Of those, older than {@link MAX_AGE_HOURS} and not held. The finding. */
  staleDisposableAccounts: number;
  /** Held back from the stale count: live billing, or standing by elsewhere. */
  heldDisposableAccounts: number;
  /** Age of the oldest disposable account, or null when there are none. */
  oldestDisposableHours: number | null;
  maxAgeHours: number;
  /** Rows pointing at a `users` row that no longer exists. */
  danglingRows: number;
  danglingBaseline: number;
  /** Rows the cascade keeps on purpose. A number, never a defect. */
  retainedRows: number;
  checkedAt: string;
}

/**
 * One statement for the whole census rather than eighteen round trips.
 *
 * Built from {@link OWNER_COLUMNS} rather than written out, so a table added to
 * the cascade reaches this probe by the same edit that reaches the sweep — the
 * contract is one list and this is one of its two consumers.
 *
 * ⚠️ TABLE AND COLUMN NAMES ARE INTERPOLATED, and they cannot be parameters —
 * no SQL dialect binds an identifier. They are safe because they come from a
 * `const` array in this repository and never from a request; the guard below
 * makes that a rule a change has to break deliberately rather than a fact about
 * today's code.
 */
export function buildCensusSql(
  pairs: ReadonlyArray<readonly [string, string]>,
): string {
  const IDENT = /^[a-z_][a-z0-9_]*$/;
  for (const [table, column] of pairs) {
    if (!IDENT.test(table) || !IDENT.test(column)) {
      throw new Error(
        `refusing to build a census over ${table}.${column}: identifiers must match ${IDENT}. ` +
          'These names are interpolated, so anything that is not a plain identifier is either a ' +
          'typo or an injection, and both should stop here.',
      );
    }
  }
  return pairs
    .map(
      ([table, column]) =>
        `SELECT '${danglingLabel(table, column)}' AS label, count(*)::text AS n ` +
        `FROM ${table} WHERE ${column} IS NOT NULL ` +
        `AND ${column} NOT IN (SELECT id FROM users)`,
    )
    .join(' UNION ALL ');
}

/** Sum a census result, tolerating the empty case. */
function total(rows: Array<{ n: string }>): number {
  return rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
}

export async function getOrphanHealth(now: Date = new Date()): Promise<OrphanHealth> {
  /*
    The reserved-domain filter is done in SQL, so this never pulls a real
    person's row into the process at all — the same choice `disposable-sweep.ts`
    makes, for the same reason.
  */
  const likes = RESERVED_TLDS.map((_, i) => `email LIKE $${i + 1}`).join(' OR ');
  const params = RESERVED_TLDS.map((tld) => `%.${tld}`);

  const accounts = await query<{ id: string; email: string; created_at: string }>(
    `SELECT id, email, created_at FROM users WHERE ${likes}`,
    params,
  );

  /*
    A held account is one with live billing or a standby role in somebody else's
    roster, and it is NEVER counted stale — "a disposable-looking account holding
    live billing" is a recorded trap in this portfolio. Both are counted in one
    statement per question rather than per account, because this runs on a probe
    and the account list is normally empty.
  */
  const ids = accounts.rows.map((r) => r.id);
  const held = new Map<string, { sub: boolean; roles: number }>();
  if (ids.length > 0) {
    const [subs, roles] = await Promise.all([
      query<{ owner_id: string }>(
        `SELECT DISTINCT owner_id FROM subscriptions WHERE owner_id = ANY($1)`,
        [ids],
      ),
      query<{ user_id: string; n: string }>(
        `SELECT user_id, count(*)::text AS n FROM (
           SELECT claimed_user_id AS user_id FROM recipients WHERE claimed_user_id = ANY($1)
           UNION ALL
           SELECT claimed_user_id AS user_id FROM verifiers WHERE claimed_user_id = ANY($1)
         ) t GROUP BY user_id`,
        [ids],
      ),
    ]);
    for (const id of ids) held.set(id, { sub: false, roles: 0 });
    for (const r of subs.rows) held.set(r.owner_id, { ...held.get(r.owner_id)!, sub: true });
    for (const r of roles.rows) {
      held.set(r.user_id, { ...held.get(r.user_id)!, roles: Number(r.n) });
    }
  }

  const rows: DisposableRow[] = accounts.rows.map((r) => ({
    id: r.id,
    email: r.email,
    created_at: r.created_at,
    // Per-table row counts are the OPERATOR's business, not a probe's. The sweep
    // reports them so a purge is an informed act; nothing here purges anything.
    rows: {},
    has_subscription: held.get(r.id)?.sub ?? false,
    standby_roles_elsewhere: held.get(r.id)?.roles ?? 0,
  }));

  // The rule is `judge`'s, imported rather than restated — a monitor that
  // re-expresses the rule it watches can disagree with it.
  const judged = judge(rows, now, MAX_AGE_HOURS);

  const [dangling, retained] = await Promise.all([
    query<{ label: string; n: string }>(buildCensusSql(OWNER_COLUMNS)),
    query<{ label: string; n: string }>(buildCensusSql(RETAINED_BY_DESIGN)),
  ]);

  const stale = staleCount(judged);
  const danglingRows = total(dangling.rows);

  return {
    healthy: stale === 0 && danglingRows <= DANGLING_BASELINE,
    disposableAccounts: judged.length,
    staleDisposableAccounts: stale,
    heldDisposableAccounts: judged.filter((j) => j.disposition === 'hold').length,
    oldestDisposableHours: judged.length
      ? Math.round(Math.max(...judged.map((j) => j.age_hours)))
      : null,
    maxAgeHours: MAX_AGE_HOURS,
    danglingRows,
    danglingBaseline: DANGLING_BASELINE,
    retainedRows: total(retained.rows),
    checkedAt: now.toISOString(),
  };
}
