/**
 * scripts/verify-schema.ts — does the cluster actually have the tables the
 * migrations say it does? Both regions, read-only.
 *
 *   npx tsx --env-file=.env.local scripts/verify-schema.ts     (npm run verify:schema)
 *
 * WHY THIS EXISTS. `db/migrations/migrate.ts` applies one named file and tracks
 * nothing — "Migrations are NOT tracked in a table; pass the file you intend to
 * apply." Nothing anywhere records which migrations reached which cluster, so
 * the question "is the schema this deploy needs present?" was answered by
 * memory. Migration 029 tried to close that with a comment loud enough to
 * shout: "⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT USES IT. Not a
 * preference — an ordering requirement with teeth."
 *
 * On 2026-08-15 the comment lost. `auth_challenges` was missing for about four
 * minutes while 029 was being applied, every passkey sign-in threw
 * `relation "auth_challenges" does not exist`, and the only thing that noticed
 * emailed the operator to say a request had failed in production — from a
 * laptop. That instance cost nothing. The same omission against production
 * takes passkey registration and sign-in down for everyone, and 029's design is
 * deliberately loud rather than silently falling back to the weaker seal, so
 * the failure is total. This turns the comment into a check.
 *
 * 🔴 BOTH REGIONS, AND THAT IS THE POINT. Multi-region failover here is an env
 * switch, not infrastructure: `DSQL_USE_SECONDARY=true` sends all traffic to
 * us-west-2. A migration applied to one region and not the other is therefore
 * invisible until the day somebody flips that switch — which is, by definition,
 * a day something has already gone wrong. Checking only the region currently
 * serving traffic would reproduce the exact class of bug this script exists to
 * catch. (Both regions were verified in agreement when this was written; the
 * check is here to notice the day they are not.)
 *
 * READ-ONLY BY CONSTRUCTION. The only statement issued is a SELECT against
 * pg_tables. It creates nothing, alters nothing and drops nothing — it is safe
 * to run against production, which is the only place worth running it.
 *
 * It is NOT in CI, for the reason verify:live is not: CI has no cluster
 * credentials. It is a command a person runs before a release, and the one to
 * run FIRST after applying a migration.
 *
 * Feature: relay-h0-mvp
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

import { declaredTables, compareSchema } from '../lib/db/schema-manifest';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'db', 'migrations');

interface Target {
  label: string;
  endpoint: string | undefined;
}

/** Reads the tables a cluster actually has. SELECT only. */
async function liveTables(endpoint: string): Promise<string[]> {
  const match = endpoint.match(/\.dsql\.([a-z0-9-]+)\.on\.aws$/i);
  const region = match ? match[1] : (process.env.AWS_REGION ?? 'us-east-1');
  const signer = new DsqlSigner({ hostname: endpoint, region });

  const client = new Client({
    host: endpoint,
    port: parseInt(process.env.DSQL_PORT ?? '5432', 10),
    database: process.env.DSQL_DATABASE ?? 'postgres',
    user: process.env.DSQL_USER ?? 'admin',
    password: () => signer.getDbConnectAdminAuthToken(),
    ssl: { rejectUnauthorized: process.env.DSQL_SSL_REJECT_UNAUTHORIZED !== 'false' },
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });

  await client.connect();
  try {
    const result = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    return result.rows.map((r) => r.tablename);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const declared = declaredTables(files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')));

  console.log(`[schema] ${files.length} migration files declare ${declared.length} tables.`);

  const targets: Target[] = [
    { label: 'primary   (us-east-1)', endpoint: process.env.DSQL_PRIMARY_ENDPOINT },
    { label: 'secondary (us-west-2)', endpoint: process.env.DSQL_SECONDARY_ENDPOINT },
  ];

  let failed = false;
  let checked = 0;

  for (const { label, endpoint } of targets) {
    if (!endpoint) {
      // Stated, never skipped silently. A region that was not checked must not
      // be mistaken for a region that passed.
      console.log(`[schema] ${label}: SKIPPED — no endpoint configured.`);
      continue;
    }

    let live: string[];
    try {
      live = await liveTables(endpoint);
    } catch (err) {
      // A region we could not reach is an unknown, not a pass.
      console.error(`[schema] ${label}: UNREACHABLE — ${(err as Error).message}`);
      failed = true;
      continue;
    }

    checked += 1;
    const { missing, undeclared } = compareSchema(declared, live);

    if (missing.length > 0) {
      console.error(
        `[schema] ${label}: ✗ ${missing.length} table(s) declared by a migration but ABSENT:\n` +
          missing.map((t) => `           - ${t}`).join('\n') +
          `\n           Apply the migration that creates them before deploying code that reads them:\n` +
          `             npx tsx --env-file=.env.local db/migrations/migrate.ts <NNN_name>.sql`,
      );
      failed = true;
    } else {
      console.log(`[schema] ${label}: ✓ all ${declared.length} declared tables present.`);
    }

    if (undeclared.length > 0) {
      // Reported, never fatal. An extra table breaks nothing, and making this an
      // error would turn the check into one people learn to skip.
      console.log(`[schema] ${label}: note — present but declared by no migration: ${undeclared.join(', ')}`);
    }
  }

  if (checked === 0) {
    console.error('[schema] FAILED: no region was actually checked.');
    process.exit(1);
  }

  if (failed) {
    console.error('[schema] FAILED — the schema does not match the migrations.');
    process.exit(1);
  }

  console.log(`[schema] OK — ${checked} region(s) match the migrations.`);
}

main().catch((err) => {
  console.error('[schema] Unexpected error:', err);
  process.exit(1);
});
