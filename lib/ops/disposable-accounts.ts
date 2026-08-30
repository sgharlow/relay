/**
 * Counting the throwaway accounts the walks leave behind on production.
 *
 * 🔴 THE GAP THIS FILLS IS ONE THIS REPO ALREADY NAMED AND THEN DID NOT CLOSE.
 * `PROJECT.yaml → deferred → verify-live-cannot-enter-ci` (D4) records, in its
 * own words:
 *
 *     "FOUR MORE were found on the production cluster, and not by the walks — by
 *      looking, after an unrelated question. […] Every run that made them
 *      REPORTED success; a walk that dies mid-way, or a fixture script that never
 *      had a close step, leaves rows and says nothing."
 *
 *     "🔑 THE REAL GAP IT EXPOSES: a separate test cluster would make the walks
 *      safe, but it would NOT make an abandoned row visible. A count of
 *      disposable accounts older than a day, checked somewhere, is a smaller and
 *      more useful thing than the cluster — and nothing in this repo does it."
 *
 * This is that count. It is deliberately NOT the test cluster, which is an
 * infrastructure decision with a cost attached and is Steve's (D4 stays open).
 * It is the cheap half that the expensive half would not have delivered anyway.
 *
 * ⚠️ IT COUNTS AND IT REPORTS. IT DOES NOT DELETE. Two reasons, both recorded
 * rather than assumed:
 *
 *   1. The deletion path already exists and is the product's own cascade,
 *      `deleteAccount()` in lib/account/lifecycle.ts. That function cancels
 *      billing first, then repairs standby roles held in OTHER owners' rosters —
 *      rows a `WHERE owner_id = $1` never touches. A hand-written DELETE here
 *      would silently skip both, and this schema has no FK constraints to catch
 *      it. D4's own purge on 2026-08-18 went through `deleteAccount()` for
 *      exactly this reason.
 *   2. "A disposable-looking account holding live billing" is a RECORDED trap in
 *      this portfolio, not a hypothetical. So an account carrying a subscription
 *      row, or standing by in somebody else's roster, is reported as HOLD and is
 *      never presented as safe to remove.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the countable half)
 */

/**
 * The domains a throwaway address is allowed to use.
 *
 * RFC 6761 reserves these as permanently undeliverable, and `lib/notify/email.ts`
 * refuses them at the send seam — so a fixture account can never spend sending
 * reputation on a hard bounce. `scripts/disposable-owner.ts` and
 * `scripts/capture-screens.ts` each carry their own copy of this list to decide
 * what they may CREATE; this one decides what may be RECOGNISED afterwards.
 *
 * ⚠️ The three must agree, or an account this repo is willing to create is one
 * this sweep cannot see — a blind spot exactly the shape of the bug. They are not
 * merged into one import, because those two scripts are standalone and run
 * without this module; `disposable-accounts.test.ts` asserts the lists match
 * instead, which is the guard this repo uses elsewhere in place of a refactor.
 */
export const RESERVED_TLDS = ['test', 'invalid', 'localhost'] as const;

/** A row as the sweep reads it. Only what is needed to judge and to report. */
export interface DisposableRow {
  id: string;
  email: string;
  created_at: Date | string;
  /** Rows the account owns, by table. Reported so a purge is an informed act. */
  rows: Record<string, number>;
  /** A billing row exists locally — the recorded trap. Never auto-anything. */
  has_subscription: boolean;
  /** This user stands by in OTHER owners' rosters; deleting orphans those. */
  standby_roles_elsewhere: number;
}

export type Disposition = 'stale' | 'recent' | 'hold';

export interface Judged extends DisposableRow {
  disposition: Disposition;
  age_hours: number;
  /** Why it is held, when it is. Empty otherwise. */
  holds: string[];
}

/** Reserved-domain addresses only. Anything else is a real person's account. */
export function isDisposableAddress(email: string): boolean {
  const tld = email.trim().toLowerCase().split('@').pop()?.split('.').pop();
  return !!tld && (RESERVED_TLDS as readonly string[]).includes(tld);
}

export function ageHours(created: Date | string, now: Date): number {
  const t = created instanceof Date ? created : new Date(created);
  return (now.getTime() - t.getTime()) / 3_600_000;
}

/**
 * Judge every row. `maxAgeHours` is the line between "a walk is running right
 * now" and "a walk finished and left this behind" — 24h by default, which is
 * D4's own phrasing ("older than a day").
 *
 * A held account is NEVER also counted stale. The report must not be able to
 * suggest deleting something it has just said is dangerous to delete.
 */
export function judge(rows: DisposableRow[], now: Date, maxAgeHours = 24): Judged[] {
  return rows.map((r) => {
    const holds: string[] = [];
    if (r.has_subscription) holds.push('has a subscriptions row — check Stripe before anything');
    if (r.standby_roles_elsewhere > 0) {
      holds.push(
        `stands by in ${r.standby_roles_elsewhere} other owner's roster${r.standby_roles_elsewhere === 1 ? '' : 's'} — deleting orphans them`,
      );
    }

    const age = ageHours(r.created_at, now);
    const disposition: Disposition = holds.length ? 'hold' : age > maxAgeHours ? 'stale' : 'recent';
    return { ...r, disposition, age_hours: age, holds };
  });
}

/** The number the sweep exists to produce. Held accounts are not stale. */
export function staleCount(judged: Judged[]): number {
  return judged.filter((j) => j.disposition === 'stale').length;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The report. Written so the ABSENCE of a finding is stated out loud rather than
 * being an empty output — "no news" and "the check did not run" look identical
 * otherwise, which is the failure this repo has caught more than any other.
 */
export function formatSweepReport(judged: Judged[], now: Date, maxAgeHours = 24): string {
  const lines: string[] = [];
  const stale = judged.filter((j) => j.disposition === 'stale');
  const held = judged.filter((j) => j.disposition === 'hold');
  const recent = judged.filter((j) => j.disposition === 'recent');

  lines.push(`Disposable-account sweep — ${now.toISOString()}`);
  lines.push(
    `Scanned ${plural(judged.length, 'reserved-domain account')}: ` +
      `${stale.length} stale (older than ${maxAgeHours}h), ${held.length} held, ${recent.length} recent.`,
  );
  lines.push('');

  if (!judged.length) {
    lines.push('No accounts on a reserved domain exist. Nothing was left behind.');
    return lines.join('\n');
  }

  const describe = (j: Judged) => {
    const owned = Object.entries(j.rows)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t}=${n}`)
      .join(' ');
    return `  ${j.email}  (${j.age_hours.toFixed(1)}h old)${owned ? `  ${owned}` : '  no rows'}`;
  };

  if (stale.length) {
    lines.push(`STALE — a run created these and never closed them:`);
    for (const j of stale) lines.push(describe(j));
    lines.push('');
    lines.push('  Close them with the product\'s own cascade, never a hand-written DELETE:');
    lines.push('    npx tsx --env-file=.env.local scripts/disposable-owner.ts close <email> <secret>');
    lines.push('  or deleteAccount(ownerId) — it cancels billing first and repairs standby');
    lines.push('  roles held in other owners\' rosters, which a WHERE owner_id never touches.');
    lines.push('');
  }

  if (held.length) {
    lines.push('HELD — do NOT delete without looking. Reported, never swept:');
    for (const j of held) {
      lines.push(describe(j));
      for (const h of j.holds) lines.push(`      ⚠️ ${h}`);
    }
    lines.push('');
  }

  if (recent.length) {
    lines.push(`RECENT — younger than ${maxAgeHours}h, so a walk may be running right now:`);
    for (const j of recent) lines.push(describe(j));
    lines.push('');
  }

  if (!stale.length) {
    lines.push('Nothing stale. Every reserved-domain account is either held or in flight.');
  }

  return lines.join('\n');
}

/**
 * Every (table, column) that points at a `users` row, as `deleteAccount()`'s
 * cascade knows them.
 *
 * 🔴 THIS LIVED INSIDE `scripts/disposable-sweep.ts` UNTIL 2026-08-30, and moving
 * it is the point rather than tidying. On that date a second consumer appeared —
 * `lib/ops/orphan-health.ts`, which answers the same question unattended — and a
 * list of eighteen table/column pairs copied into two files is a contract
 * expressed twice. The portfolio rule is explicit: one authoritative definition
 * per cross-boundary contract, never re-expressed at a second call site. A table
 * added to one copy and not the other would mean the monitor and the operator's
 * own sweep disagreeing about what an orphan is, silently, in the direction
 * where the monitor sees less.
 *
 * Order is `deleteAccount()`'s, so a reader comparing the two sees the same
 * sequence.
 */
export const OWNER_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['vault_items', 'owner_id'],
  ['recipients', 'owner_id'],
  ['verifiers', 'owner_id'],
  ['access_rules', 'owner_id'],
  ['release_state', 'owner_id'],
  ['invitations', 'owner_id'],
  ['access_requests', 'owner_id'],
  ['access_policies', 'owner_id'],
  ['approvals', 'owner_id'],
  ['subscriptions', 'owner_id'],
  ['recipient_codes', 'owner_id'],
  ['verifier_codes', 'owner_id'],
  ['break_glass_codes', 'owner_id'],
  ['delegations', 'owner_id'],
  ['delegations', 'delegate_user_id'],
  ['webauthn_credentials', 'user_id'],
  ['recovery_codes', 'user_id'],
  ['auth_challenges', 'user_id'],
] as const;

/**
 * Rows that OUTLIVE their user on purpose, and must never be counted as orphans.
 *
 * `deleteAccount()` keeps the audit trail deliberately — it is stated on the
 * privacy page and handed back as `auditEntriesRetained`, so that closing a real
 * person's account does not erase the record that it happened — and it removes
 * the `users` row LAST. So a dangling `audit_log.owner_id` is the DESIGNED END
 * STATE of every correct closure, not wreckage.
 *
 * ⚠️ THIS DISTINCTION WAS ONCE GOT WRONG IN THE OTHER DIRECTION, and the sweep's
 * header records it: every correct account closure printed
 * `FAIL: N row(s) point at a user that no longer exists`. An alarm that fires
 * when nothing is wrong is an alarm that gets muted, so the count is kept and
 * reported and does not fail anything.
 */
export const RETAINED_BY_DESIGN: ReadonlyArray<readonly [table: string, column: string]> = [
  ['audit_log', 'owner_id'],
] as const;

/** `table.column`, the label both the sweep and the probe report under. */
export function danglingLabel(table: string, column: string): string {
  return `${table}.${column}`;
}
