/**
 * scripts/disposable-sweep.ts — count the throwaway accounts the walks left behind.
 *
 *   npm run verify:orphans       (runs as `relay_ro` via --env-file=.env.ro)
 *   npm run verify:orphans -- --hours 72
 *
 * ⚠️ This said `--env-file=.env.local` until 2026-08-29. `package.json` runs it on
 * `.env.ro` (`relay_ro`). A stale warning costs more than a stale claim because it
 * is obeyed — this one sent an operator for the credential that can WRITE in order
 * to run a read-only check. It was NOT on the ROADMAP H list; a grep for
 * `env-file=.env.local` across scripts/ found it.
 *
 * WHY THIS EXISTS, in D4's own words (`PROJECT.yaml → deferred →
 * verify-live-cannot-enter-ci`): *"a separate test cluster would make the walks
 * safe, but it would NOT make an abandoned row visible. A count of disposable
 * accounts older than a day, checked somewhere, is a smaller and more useful
 * thing than the cluster — and nothing in this repo does it."*
 *
 * Four accounts were found on production on 2026-08-18 by looking, after an
 * unrelated question. Every run that created them reported success. That is the
 * failure mode: not a walk that fails loudly, but a walk that dies mid-way or a
 * fixture script with no close step, leaving rows and saying nothing.
 *
 * READ-ONLY. The only statements are SELECTs. It reports and it exits non-zero;
 * it never deletes. The deletion path is the product's own cascade —
 * `deleteAccount()` cancels billing FIRST and then repairs standby roles held in
 * other owners' rosters, rows a `WHERE owner_id = $1` never touches — and this
 * schema has no FK constraints, so a hand-written DELETE here would corrupt
 * quietly. An account carrying a subscription row or standing by for somebody
 * else is reported as HELD and never as sweepable.
 *
 * EXIT CODE IS THE POINT. 1 when anything stale exists, so this can be wired to
 * something that watches. A sweep whose only output is prose is a sweep nobody
 * notices going quiet — the exact shape of the bug it was written for.
 *
 * NOT IN CI, for the reason verify:schema and verify:live are not: CI holds no
 * cluster credentials. NEEDS .env.local, no server.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the countable half)
 */

import { Client } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

import { dsqlIdentity } from '../lib/db/connection';
import {
  RESERVED_TLDS,
  judge,
  staleCount,
  formatSweepReport,
  type DisposableRow,
} from '../lib/ops/disposable-accounts';

/**
 * Every table an owner's rows live in, as `deleteAccount()`'s cascade knows them.
 * Reported per account so a purge is an informed act rather than a leap.
 */
const OWNED_TABLES = [
  'vault_items',
  'recipients',
  'verifiers',
  'access_rules',
  'release_state',
  'invitations',
  'audit_log',
] as const;

function hoursArg(): number {
  const i = process.argv.indexOf('--hours');
  if (i === -1) return 24;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--hours needs a positive number, got ${process.argv[i + 1]}`);
  return n;
}

/** Same connection shape as flight-snapshot: one region, failover switch honoured. */
async function connect(): Promise<Client> {
  const useSecondary = process.env.DSQL_USE_SECONDARY === 'true';
  const endpoint = useSecondary
    ? process.env.DSQL_SECONDARY_ENDPOINT
    : process.env.DSQL_PRIMARY_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      `${useSecondary ? 'DSQL_SECONDARY_ENDPOINT' : 'DSQL_PRIMARY_ENDPOINT'} is not set — ` +
        'run `npm run verify:orphans`, which supplies --env-file=.env.ro',
    );
  }

  const match = endpoint.match(/\.dsql\.([a-z0-9-]+)\.on\.aws$/i);
  const region = match ? match[1] : (process.env.AWS_REGION ?? 'us-east-1');
  const signer = new DsqlSigner({ hostname: endpoint, region });
  const { user, admin } = dsqlIdentity();

  const client = new Client({
    host: endpoint,
    port: parseInt(process.env.DSQL_PORT ?? '5432', 10),
    database: process.env.DSQL_DATABASE ?? 'postgres',
    user,
    password: () => (admin ? signer.getDbConnectAdminAuthToken() : signer.getDbConnectAuthToken()),
    ssl: { rejectUnauthorized: process.env.DSQL_SSL_REJECT_UNAUTHORIZED !== 'false' },
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });
  await client.connect();
  return client;
}

async function main(): Promise<void> {
  const maxAgeHours = hoursArg();
  const client = await connect();

  try {
    /*
      The reserved-domain filter is done in SQL so the sweep never pulls real
      users' addresses across the wire to discard them locally. `LIKE` per TLD
      rather than a regex: DSQL is PostgreSQL-compatible but this stays plainly
      readable, and the list is three entries long.
    */
    const likes = RESERVED_TLDS.map((_, i) => `email LIKE $${i + 1}`).join(' OR ');
    const params = RESERVED_TLDS.map((tld) => `%.${tld}`);

    const users = await client.query<{ id: string; email: string; created_at: Date }>(
      `SELECT id, email, created_at FROM users WHERE ${likes} ORDER BY created_at`,
      params,
    );

    const rows: DisposableRow[] = [];
    for (const u of users.rows) {
      const counts: Record<string, number> = {};
      for (const table of OWNED_TABLES) {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table} WHERE owner_id = $1`,
          [u.id],
        );
        counts[table] = Number(r.rows[0]?.n ?? 0);
      }

      const sub = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM subscriptions WHERE owner_id = $1',
        [u.id],
      );

      /*
        The role held in SOMEBODY ELSE'S roster. This is the check the 2026-08-12
        production incident exists for: after deleting a standby contact's
        account, the other owner's roster still read `standby_state = 'claimed'`
        pointing at a user id that no longer existed — a covered circle, a quiet
        readiness banner, and nobody there on the day.

        ⚠️ THE SHAPE OF THIS QUERY IS COPIED FROM `deleteAccount()` ON PURPOSE
        and must stay that way: same two tables, same `claimed_user_id` column,
        same UNION ALL. That function is the authority on what a standby role IS,
        and a sweep that recognised a different set than the cascade repairs
        would report an account safe that deleting would in fact orphan.
        `disposable-sweep-matches-the-cascade.test.ts` fails if the two diverge.

        (The first draft of this file asked for `standby_user_id`, which exists in
        no migration and in no query — the column is `claimed_user_id`. It would
        have thrown on the first real run, which is exactly the wired-not-live-
        proven gap this repo keeps catching.)
      */
      const standby = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM recipients WHERE claimed_user_id = $1
         UNION ALL
         SELECT count(*)::text AS n FROM verifiers  WHERE claimed_user_id = $1`,
        [u.id],
      );
      const standbyElsewhere = standby.rows.reduce((a, r) => a + Number(r.n ?? 0), 0);

      rows.push({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        rows: counts,
        has_subscription: Number(sub.rows[0]?.n ?? 0) > 0,
        standby_roles_elsewhere: standbyElsewhere,
      });
    }

    const now = new Date();
    const judged = judge(rows, now, maxAgeHours);
    console.log(formatSweepReport(judged, now, maxAgeHours));

    const stale = staleCount(judged);
    if (stale > 0) {
      console.log('');
      console.log(`FAIL: ${stale} disposable account(s) older than ${maxAgeHours}h are still on the cluster.`);
      process.exitCode = 1;
    }

    /*
      🔴 THE CENSUS ABOVE IS STRUCTURALLY BLIND TO THE WORST OUTCOME, and was
      from its first line. Every account it can see is reached by joining OUT of
      the users table (`FROM users WHERE email LIKE …`). So the moment a users
      row is gone, everything that row owned becomes invisible here — and a
      users-row-only delete is precisely what three fixture scripts were doing
      (capture-screens.ts deleted nothing else at all, and then printed "cluster
      clean"). The one shape this sweep exists to report was the one shape it
      could not report.

      This is deliberately a different question from the one above. That one asks
      "whose account is still here?"; this asks "whose rows are here with nobody
      to own them?" — the wreckage of a purge that half-ran, a script that died
      between statements, or a hand-written cascade shorter than the real one.
      Neither question implies the other.

      READ-ONLY like the rest of the file. It counts and it fails the run; it
      never deletes. Repairing an orphan needs a human decision about which of
      two bad states is being restored, and this schema has no foreign keys to
      make the answer obvious.

      The per-table column is named rather than assumed: most owned tables key on
      `owner_id`, but the ones that belong to a PERSON rather than to a vault key
      on `user_id`, and asking the wrong column returns a clean zero instead of
      an error.

      The list is derived from `deleteAccount()` — every table it purges by an
      owner id, and both of `delegations`' two. Tables it reaches through a
      subquery (`verifier_confirmations` by `release_state_id`,
      `consent_artifacts` by the `delegations` row that points at it) are
      absent because they carry no owner id at all: they cannot be censused this
      way, and their orphans are reachable only by re-walking the pointers.
      `disposable-sweep-matches-the-cascade.test.ts` fails if the cascade grows
      an owner-scoped table this list does not carry — `delegations` was exactly
      that omission, and it was invisible for the same reason everything else
      here is.
    */
    const OWNER_COLUMNS: [table: string, column: string][] = [
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
    ];

    /*
      🔴 `audit_log` WAS IN THE LIST ABOVE FOR ITS FIRST DAY, AND THAT MADE THIS
      CENSUS FAIL ON A CLUSTER IN A PERFECTLY CORRECT STATE.

      `deleteAccount()` writes an `account_deleted` entry, then RETAINS the audit
      trail on purpose — it is stated on the privacy page and handed back as
      `auditEntriesRetained`, so that closing a real person's account does not
      erase the record that it happened — and it deletes the users row LAST. So
      a dangling `audit_log.owner_id` is the DESIGNED END STATE of every correct
      closure, not wreckage, and every one of them printed
      `FAIL: N row(s) point at a user that no longer exists`.

      An alarm that fires when nothing is wrong is an alarm that gets muted,
      which is the failure this file's own header is written against — so it was
      manufacturing the very shape it exists to prevent.

      Counted anyway, and reported as a NOTICE. The number is worth having: it is
      the only remaining trace of a closed account, and a jump in it is what a
      purge looks like from here. It simply is not a defect, so it does not fail
      the run.

      (Fixture scripts are the exception, and they handle it themselves:
      reset-demo.ts, family-arc.ts and capture-screens.ts each delete the audit
      rows of the throwaway accounts they created, because a fixture's audit
      trail is nobody's record.)
    */
    const RETAINED_BY_DESIGN: [table: string, column: string][] = [['audit_log', 'owner_id']];

    const countDangling = async (table: string, column: string): Promise<number | null> => {
      try {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table}
            WHERE ${column} IS NOT NULL AND ${column} NOT IN (SELECT id FROM users)`,
        );
        return Number(r.rows[0]?.n ?? 0);
      } catch (err) {
        /*
          NOT swallowed. A table this sweep cannot read is a table it cannot
          vouch for, and reporting "no orphans" on the strength of a failed
          query is the false green this whole file was written against. It is
          reported and it fails the run, the same as finding orphans would.
        */
        console.log(`  ! could not census ${table}.${column}: ${(err as Error).message}`);
        process.exitCode = 1;
        return null;
      }
    };

    const dangling: [label: string, n: number][] = [];
    for (const [table, column] of OWNER_COLUMNS) {
      const n = await countDangling(table, column);
      // Both columns of `delegations` are censused, so the label names which.
      if (n !== null && n > 0) dangling.push([`${table}.${column}`, n]);
    }

    const retained: [label: string, n: number][] = [];
    for (const [table, column] of RETAINED_BY_DESIGN) {
      const n = await countDangling(table, column);
      if (n !== null && n > 0) retained.push([`${table}.${column}`, n]);
    }

    console.log('');
    if (dangling.length === 0) {
      /*
        Worded around the audit trail deliberately. "No rows point at a user that
        no longer exists" would be a lie printed directly above a NOTICE saying
        some do — the retained ones — and a report that contradicts itself two
        lines later teaches the reader to skim both halves.
      */
      console.log('Orphan census: nothing unowned in any table the cascade purges.');
    } else {
      const total = dangling.reduce((a, [, n]) => a + n, 0);
      console.log(`FAIL: ${total} row(s) point at a user that no longer exists:`);
      for (const [label, n] of dangling) console.log(`  ${label}: ${n}`);
      console.log('');
      console.log('Something deleted a users row without running the cascade. The rows are');
      console.log('unreachable through the application and invisible to the account census');
      console.log('above. Decide per table whether to purge them; deleteAccount() cannot help');
      console.log('once the users row is gone, which is the reason it deletes that row LAST.');
      process.exitCode = 1;
    }

    if (retained.length > 0) {
      const total = retained.reduce((a, [, n]) => a + n, 0);
      console.log('');
      console.log(`NOTICE: ${total} retained row(s) belong to accounts that have been closed:`);
      for (const [label, n] of retained) console.log(`  ${label}: ${n}`);
      console.log('Expected. deleteAccount() keeps the audit trail on purpose and removes the');
      console.log('users row last, so a closed account leaves exactly this behind. Not a failure.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
