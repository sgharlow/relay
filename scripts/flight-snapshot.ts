/**
 * scripts/flight-snapshot.ts — the G1 flight's daily read, and the pre-flight
 * line that had no command.
 *
 *   npx tsx --env-file=.env.local scripts/flight-snapshot.ts   (npm run flight:snapshot)
 *
 * WHY THIS EXISTS. `docs/g1-sitting-sheet.md` lists three things to run before
 * the card comes out. Two were commands. The third — "live `caregiver_leads`
 * count · **0 rows** — the flight starts from zero or N is contaminated from
 * day one" — was a sentence, and the person meant to satisfy it had to
 * hand-write a query against production while a sitting was in progress. The
 * same sheet then says "then daily: `npm run verify:funnel` first, then the
 * snapshot table", and `docs/g1-flight-log.md` wants a lead count in that
 * table every day for four weeks.
 *
 * 🔴 THESE TWO NUMBERS ARE NOT SIDE MATERIAL. The read is ratified DIRECTIONAL
 * (`PROJECT.yaml` `ratified.g1-flight-power`): the $250 ceiling buys N ≈ 100–180
 * against an honest minimum near 250, so "a ship or kill call on line 1 alone is
 * not permitted for this flight" and lines 3 and 4 of the verdict — the count of
 * contactable humans, and their notes quoted — are expected to CARRY the
 * decision. Both are read from `caregiver_leads` and from nowhere else.
 *
 * READ-ONLY TWICE OVER. The only statements are SELECTs, and the identity in
 * `.env.local` is the `relay_dev` role, for which `caregiver_leads` is the one
 * table in the product with `SELECT` and nothing else (sprint 5 AC2: `S---`
 * against `relay_app`'s `SIUD`). A stray write from this script is refused by
 * the database rather than by the author having been careful. It is therefore
 * safe against production, which is the only place worth running it.
 *
 * It deliberately does NOT print the analytics numbers. Vercel Analytics is
 * read in the dashboard, and inventing a second path to N — the denominator the
 * gate turns on — would be a second definition of the measurement. The row it
 * prints leaves those cells marked for the human who is looking at the
 * dashboard anyway.
 *
 * NOT IN CI, for the reason verify:schema and verify:live are not: CI holds no
 * cluster credentials.
 *
 * Feature: relay-g1-wtp
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

import { dsqlIdentity } from '../lib/db/connection';
import { windowStarted, preFlightVerdict, formatSnapshotRow } from '../lib/g1/flight-snapshot';
import { isGateQualifyingSrc } from '../src/app/caregivers/content';

const FLIGHT_LOG = path.resolve(__dirname, '..', 'docs', 'g1-flight-log.md');

interface Lead {
  email: string;
  note: string | null;
  src: string | null;
  cta: string | null;
  notified: boolean;
  created_at: Date;
}

async function connect(): Promise<Client> {
  /*
    One region is enough here, and only here. verify:schema deliberately checks
    BOTH, because a migration or a grant can land on one and not the other and
    stay invisible until somebody flips DSQL_USE_SECONDARY. Rows are the other
    case: the cluster is active-active with strong consistency, so a committed
    lead is the same lead in both regions, and reading twice would report one
    number as two. The failover switch is still honoured, so this reads whatever
    the app would read.
  */
  const useSecondary = process.env.DSQL_USE_SECONDARY === 'true';
  const endpoint = useSecondary
    ? process.env.DSQL_SECONDARY_ENDPOINT
    : process.env.DSQL_PRIMARY_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      `${useSecondary ? 'DSQL_SECONDARY_ENDPOINT' : 'DSQL_PRIMARY_ENDPOINT'} is not set — ` +
        `run with --env-file=.env.local`,
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
  const log = readFileSync(FLIGHT_LOG, 'utf8');
  const open = windowStarted(log);

  const client = await connect();
  let leads: Lead[];
  try {
    const { user } = dsqlIdentity();
    console.log(`[flight] connected as ${user} — SELECT only\n`);
    const res = await client.query<Lead>(
      `SELECT email, note, src, cta, notified, created_at
         FROM caregiver_leads
        ORDER BY created_at`,
    );
    leads = res.rows;
  } finally {
    await client.end();
  }

  const today = new Date().toISOString().slice(0, 10);

  console.log(`  window          ${open ? 'OPEN' : 'not started'}  (docs/g1-flight-log.md)`);
  console.log(`  caregiver_leads ${leads.length} row(s)\n`);

  /*
    Verdict line 4 is "the lead notes, quoted" and is expected to carry the
    decision. Printing them here is the whole reason a count alone would not
    have been enough: the question the flight actually asks is whether the pain
    we assumed is the pain they describe, and that is not a number.
  */
  if (leads.length) {
    console.log('  --- leads -------------------------------------------------');
    for (const l of leads) {
      const stamp = new Date(l.created_at).toISOString().slice(0, 16).replace('T', ' ');
      const src = l.src ?? 'untagged';
      const gate = isGateQualifyingSrc(src) ? 'gate' : 'excluded';
      console.log(`  ${stamp}  ${l.email}`);
      console.log(`      src=${src} (${gate})  cta=${l.cta ?? '—'}  notified=${l.notified}`);
      if (l.note) console.log(`      note: ${JSON.stringify(l.note)}`);
      /*
        notified=false is a lead whose email leg broke while the database leg
        held — migration 013 says so: "a lead that still needs a human reply".
        It is called out rather than left as a column to notice.
      */
      if (!l.notified) console.log('      ⚠️  NOT NOTIFIED — nobody was emailed about this lead');
    }
    console.log('  -----------------------------------------------------------\n');
  }

  const srcs = [...new Set(leads.map((l) => l.src ?? 'untagged').filter(isGateQualifyingSrc))];
  console.log('  Paste into the daily snapshot table in docs/g1-flight-log.md:');
  console.log(`  ${formatSnapshotRow({ date: today, leads: leads.length, qualifiedLeadSrcs: srcs })}\n`);

  const verdict = preFlightVerdict({ windowStarted: open, leads: leads.length });
  if (!verdict.ok) {
    console.error(`[flight] ✗ ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`[flight] ✓ ${verdict.reason}`);
  if (!open) console.log('[flight]   next: npm run verify:funnel — the instrument, before the money');
}

main().catch((err: unknown) => {
  console.error('[flight] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
