/**
 * scripts/verify-csp.ts — read the CSP violation reports the policy has collected.
 *
 *   npm run verify:csp                    (last 14 days)
 *   npm run verify:csp -- --days 30
 *
 * ⚠️ Wired on `.env.ro` (the read-only `relay_ro` identity), NOT `.env.local`, and
 * these two lines said `.env.local` until 2026-08-29 (B21.1) — a header telling
 * an operator to reach for the credential that can also WRITE, for a script whose
 * own paragraph below says it performs one SELECT. `relay_ro` is exactly the
 * identity this belongs to, and it is the identity an unattended agent can hold.
 *
 * 🔴 WHY THIS EXISTS. Migration 038 created `csp_reports` so the report-only
 * policy's stated plan could execute: "observe real traffic, remove what nothing
 * needs, then take the middleware decision on evidence." `csp-report-store.ts`
 * writes to it. Until 2026-08-21 NOTHING READ IT — no script, no endpoint, no
 * query anywhere in lib/, src/, scripts/ or docs/. D9 was closed on a sink with
 * no reader, which moves the evidence from a log that forgets in a day to a
 * table nobody opens. Both are the same answer to "what would the stricter
 * script-src block?": silence.
 *
 * ⚠️ AN EMPTY RESULT HAS TWO OPPOSITE MEANINGS AND THIS SCRIPT WILL NOT GUESS
 * BETWEEN THEM. Zero rows is either "nothing violates the policy" or "reports
 * are not reaching the endpoint at all" — and the second has already happened
 * here in a related form: headless Chromium logs CSP violations at INFO level
 * and delivered none, so a browser-driven check saw a clean table and concluded
 * the wrong thing. The report below says so on every zero, and names the way to
 * tell the difference: open the live site in a REAL browser, watch the console,
 * and re-run this.
 *
 * READ-ONLY. One SELECT, no writes, no deletes. Pruning this table is a decision
 * about how long the observation window should be, and 038's own note says to
 * prune by `ts` when that decision is taken — not as a side effect of reading.
 *
 * WHAT `disposition` MEANS, because the whole value of the output is this split:
 *   enforce — the LIVE policy blocked it. Something on the site was broken for
 *             a real person, and this is a defect to fix now.
 *   report  — the STRICTER policy (the next rung) would have blocked it, and
 *             nothing broke. This is the evidence the rung decision needs.
 *
 * NEEDS `.env.local`, no server. Not in CI, for the reason verify:schema and
 * verify:orphans are not: CI holds no cluster credentials.
 *
 * Feature: relay-h0-mvp
 * Requirements: D9 (the reading half)
 */

import { Client } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

import { dsqlIdentity } from '../lib/db/connection';

function daysArg(): number {
  const i = process.argv.indexOf('--days');
  if (i === -1) return 14;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--days needs a positive number, got ${process.argv[i + 1]}`);
  }
  return n;
}

/**
 * Same connection shape as disposable-sweep.ts and flight-snapshot.ts: one
 * region, the failover switch honoured. Copied rather than shared because those
 * two already agree on it and a third caller is not yet a reason to move it —
 * but if a fourth appears, move it.
 */
async function connect(): Promise<Client> {
  const useSecondary = process.env.DSQL_USE_SECONDARY === 'true';
  const endpoint = useSecondary
    ? process.env.DSQL_SECONDARY_ENDPOINT
    : process.env.DSQL_PRIMARY_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      `${useSecondary ? 'DSQL_SECONDARY_ENDPOINT' : 'DSQL_PRIMARY_ENDPOINT'} is not set — ` +
        'run `npm run verify:csp`, which supplies --env-file=.env.ro',
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

interface Group {
  disposition: string | null;
  directive: string | null;
  blocked: string | null;
  document: string | null;
  n: string;
  first_seen: Date;
  last_seen: Date;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

import { splitEnforced, nextRungVerdict } from '../lib/ops/csp-violations';

async function main(): Promise<void> {
  const days = daysArg();
  const client = await connect();

  try {
    /*
      Grouped rather than listed. A single broken page can emit hundreds of
      identical reports — the endpoint's rate limit is per-instance memory, so
      on serverless it is a speed bump — and a screen of duplicates is the same
      nothing as an empty table. The counts and the first/last timestamps are
      what answer "is this still happening?".
    */
    const res = await client.query<Group>(
      `SELECT disposition, directive, blocked, document,
              count(*)::text AS n,
              min(ts) AS first_seen,
              max(ts) AS last_seen
         FROM csp_reports
        WHERE ts > now() - ($1 || ' days')::interval
        GROUP BY disposition, directive, blocked, document
        ORDER BY count(*) DESC`,
      [String(days)],
    );

    console.log(`CSP violation reports, last ${days} day(s)\n`);

    if (res.rows.length === 0) {
      console.log('  No rows.');
      console.log('');
      console.log('  ⚠️  READ THIS AS "WE COULD NOT SEE", NOT AS "NOTHING VIOLATES".');
      console.log('  An empty csp_reports is indistinguishable from reports never arriving.');
      console.log('  Before concluding anything about the stricter policy:');
      console.log('    1. Open https://relaystandby.com in a REAL browser (not headless — ');
      console.log('       headless Chromium logs violations at INFO and delivers none).');
      console.log('    2. Watch the console for a CSP report being POSTed to /api/csp-report.');
      console.log('    3. Re-run this. If it is still empty, the reporting path is broken,');
      console.log('       which is a finding about the policy rather than about the site.');
      console.log('');
      console.log('  Also check migration 038 has reached this cluster: npm run verify:schema.');
      console.log('  csp-report-store.ts latches quietly on a missing table by design.');
      return;
    }

    const enforced = res.rows.filter((r) => r.disposition === 'enforce');
    const wouldBlock = res.rows.filter((r) => r.disposition !== 'enforce');

    const show = (title: string, rows: Group[]) => {
      if (rows.length === 0) return;
      console.log(`  ${title}`);
      console.log(
        `    ${pad('n', 7)}${pad('directive', 24)}${pad('blocked', 44)}${pad('document', 30)}last seen`,
      );
      for (const r of rows) {
        console.log(
          `    ${pad(r.n, 7)}${pad(r.directive ?? '—', 24)}${pad(r.blocked ?? '—', 44)}` +
            `${pad(r.document ?? '—', 30)}${r.last_seen.toISOString()}`,
        );
      }
      console.log('');
    };

    /*
      🔴 SPLIT ON 2026-08-31 (B21.2). All six enforced rows that day were the
      Vercel toolbar — injected into the production origin for a signed-in
      operator, absent from the production HTML, and refused by a policy doing
      exactly its job. Reporting that as "a real person met a broken page" sends
      the reader hunting for a defect that does not exist, and the reader who
      learns to discount it stops reading this section at all. Then a REAL
      enforced violation arrives somewhere nobody looks.
    */
    const { productDefects, refusedThirdParty } = splitEnforced(enforced);

    show(
      'ENFORCED — the live policy BLOCKED these, and the product serves them. A real person met a broken page.',
      productDefects,
    );
    if (refusedThirdParty.length > 0) {
      show(
        'ENFORCED but NOT a defect — a third party the product never asked for, correctly refused.',
        refusedThirdParty.map((x) => x.row),
      );
      for (const reason of new Set(refusedThirdParty.map((x) => x.reason))) {
        console.log(`    why: ${reason}`);
      }
      console.log('');
    }
    show(
      'REPORT-ONLY — the stricter policy WOULD have blocked these. Nothing broke.',
      wouldBlock,
    );

    const total = res.rows.reduce((a, r) => a + Number(r.n), 0);
    console.log(
      `  ${total} report(s) in ${res.rows.length} distinct violation(s): ` +
        `${enforced.length} enforced, ${wouldBlock.length} report-only.`,
    );

    /*
      B21.2 exists so B21.3/B21.4 can be RULED, and the ruling turns on whether
      tightening the policy would break the product. Printed rather than left for
      the reader to infer from a table.
    */
    const rung = nextRungVerdict(wouldBlock);
    console.log('');
    console.log(`  NEXT RUNG: ${rung.takeable ? 'takeable' : 'NOT takeable'} — ${rung.because}`);

    if (productDefects.length > 0) {
      console.log('');
      console.log('  The ENFORCED rows above are defects, not evidence. Something the product');
      console.log('  serves is being blocked right now — fix those before reading the');
      console.log('  report-only half as a verdict on the next rung.');
      process.exitCode = 1;
    } else if (refusedThirdParty.length > 0) {
      console.log('');
      console.log('  No product code is being blocked. The enforced rows are third-party');
      console.log('  tooling the policy correctly refused — recorded, not a defect.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
