/**
 * db/migrations/migrate.ts
 *
 * Applies ONE named DDL migration against an Aurora DSQL endpoint.
 *
 * Usage:
 *   npx tsx db/migrations/migrate.ts 0NN_name.sql   # the filename is REQUIRED
 *
 * Migrations are NOT tracked in a table; pass the file you intend to apply.
 * There is no default and there must not be one — see the SQL_FILENAME note.
 * 001 is the fresh-schema bootstrap; later files (e.g. 002) are applied
 * individually, under the infra-change gate where relevant.
 *
 * Required environment variables (see .env.example):
 *   DSQL_PRIMARY_ENDPOINT   — e.g. <cluster-id>.dsql.us-east-1.on.aws
 *   DSQL_PORT               — default: 5432
 *   DSQL_DATABASE           — default: postgres
 *   DSQL_USER               — IAM-authed user (e.g. "admin")
 *   DSQL_PASSWORD           — IAM token or static credential
 *
 * DSQL connection notes:
 *   - Authentication is IAM-based; DSQL_PASSWORD should be a short-lived
 *     IAM auth token generated via the DSQL SDK / AWS CLI before running
 *     this script in production.
 *   - SSL is required by DSQL. The pg client is configured with
 *     ssl: { rejectUnauthorized: true } by default; pass
 *     DSQL_SSL_REJECT_UNAUTHORIZED=false only in local/test environments.
 *   - No FK constraints are created; all referential integrity is
 *     enforced at the application layer (lib/db/integrity.ts).
 *   - OCC via DSQL snapshot isolation is automatic; no configuration needed.
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
// Pure and file-free (it takes SQL text, not paths), so importing it here costs
// no database and no credentials — and it is the SAME parser `verify:schema`
// uses, which is what stops this tool and that check disagreeing about what a
// migration declares.
import { declaredTables } from '../../lib/db/schema-manifest';

// ---------------------------------------------------------------------------
// Configuration — read from environment variables
// ---------------------------------------------------------------------------
const ENDPOINT = process.env.DSQL_PRIMARY_ENDPOINT;
const PORT = parseInt(process.env.DSQL_PORT ?? '5432', 10);
const DATABASE = process.env.DSQL_DATABASE ?? 'postgres';
const USER = process.env.DSQL_USER ?? 'admin';
const PASSWORD = process.env.DSQL_PASSWORD;
const SSL_REJECT_UNAUTHORIZED =
  process.env.DSQL_SSL_REJECT_UNAUTHORIZED !== 'false';

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------
if (!ENDPOINT) {
  console.error(
    '[migrate] ERROR: DSQL_PRIMARY_ENDPOINT environment variable is not set.\n' +
      '  Set it to your Aurora DSQL regional endpoint, e.g.:\n' +
      '    export DSQL_PRIMARY_ENDPOINT=<cluster-id>.dsql.us-east-1.on.aws',
  );
  process.exit(1);
}

/**
 * Authentication, matching how the APPLICATION connects.
 *
 * 🔴 THIS SCRIPT COULD NOT REACH THE CLUSTER THE APP USES. It demanded a static
 * `DSQL_PASSWORD` and exited if one was absent — but Aurora DSQL authenticates
 * with short-lived IAM tokens, `lib/db/connection.ts` mints one per connection
 * via `DsqlSigner`, and no `.env` in this repo carries a static password because
 * there is no such thing to carry. So the one env file that lets `npm run dev`
 * talk to DSQL was exactly the env file that made the migration runner refuse to
 * start, and every migration since 001 had to be applied by hand-generating a
 * token first. A migration tool that cannot authenticate to the database is a
 * migration tool that does not get run.
 *
 * `DSQL_PASSWORD` still wins when set, so any existing invocation keeps working.
 */
function passwordSource(): string | (() => Promise<string>) {
  if (PASSWORD) return PASSWORD;

  const m = (ENDPOINT as string).match(/\.dsql\.([a-z0-9-]+)\.on\.aws$/i);
  const region = m ? m[1] : (process.env.AWS_REGION ?? 'us-east-1');
  const signer = new DsqlSigner({ hostname: ENDPOINT as string, region });
  console.log(`[migrate] No DSQL_PASSWORD — minting an IAM auth token for ${region}.`);
  return () => signer.getDbConnectAdminAuthToken();
}

// ---------------------------------------------------------------------------
// Read SQL file. THE FILENAME IS REQUIRED.
//
// 🔴 IT USED TO DEFAULT: `process.argv[2] ?? '001_initial.sql'`. A bare
// invocation against the production cluster therefore re-ran the bootstrap, as
// `admin`, with DDL rights. It was harmless only by accident — every CREATE
// TABLE hits 42P07 and is skipped below — and migration 029's header had
// already had to warn "migrate.ts applies ONE named file and silently applies
// 001 if called bare — pass the filename". That is a comment asking somebody to
// remember, on the one tool here that can drop a table. Removed 2026-08-21.
// ---------------------------------------------------------------------------
const SQL_FILENAME = process.argv[2];
if (!SQL_FILENAME) {
  console.error('[migrate] ERROR: name the migration to apply.');
  console.error('  npx tsx --env-file=.env.admin db/migrations/migrate.ts 0NN_name.sql');
  console.error('  Migrations are NOT tracked in a table, so this applies exactly what you name');
  console.error('  and nothing else. `npm run verify:schema` reports what a cluster has.');
  process.exit(1);
}
// Basename only — never apply files outside this directory.
const SQL_FILE = path.resolve(__dirname, path.basename(SQL_FILENAME));

let sql: string;
try {
  sql = fs.readFileSync(SQL_FILE, 'utf8');
} catch (err) {
  console.error(`[migrate] ERROR: Could not read migration file at ${SQL_FILE}`, err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Apply migration
// ---------------------------------------------------------------------------
async function migrate(): Promise<void> {
  console.log(`[migrate] Connecting to DSQL endpoint: ${ENDPOINT}:${PORT}/${DATABASE}`);

  const client = new Client({
    host: ENDPOINT,
    port: PORT,
    database: DATABASE,
    user: USER,
    password: passwordSource(),
    ssl: {
      rejectUnauthorized: SSL_REJECT_UNAUTHORIZED,
    },
    // DSQL connections should time out quickly to surface misconfiguration
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
  });

  try {
    await client.connect();
    console.log('[migrate] Connected successfully.');

    // DSQL runs each DDL in its own implicit transaction and rejects multiple
    // DDL statements in a single (multi-statement) transaction — so apply the
    // file statement-by-statement rather than as one client.query(sql) batch.
    console.log(`[migrate] Applying ${SQL_FILENAME} statement-by-statement (DSQL) ...`);
    const statements = sql
      .split(/\r?\n/) // CRLF-safe
      .map((line) => line.replace(/--.*/, '')) // strip line + inline comments (may contain ';'); no $ anchor so a trailing \r doesn't defeat it
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const [i, stmt] of statements.entries()) {
      const label = stmt.split('\n').find((l) => l.trim())?.slice(0, 64) ?? '';
      try {
        await client.query(stmt);
        console.log(`[migrate]   (${i + 1}/${statements.length}) ${label}`);
      } catch (e) {
        // Idempotent: skip objects that already exist (re-run after a partial apply).
        const code = (e as { code?: string }).code;
        const msg = (e as Error).message ?? '';
        if (code === '42P07' || code === '42710' || /already exists/i.test(msg)) {
          console.log(`[migrate]   (${i + 1}/${statements.length}) ${label}  (exists, skip)`);
          continue;
        }
        throw e;
      }
    }
    console.log('[migrate] Migration applied successfully.');

    // Quick sanity check — list the tables we just created
    const result = await client.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename`,
    );
    const tables = result.rows.map((r) => r.tablename);
    console.log('[migrate] Tables present in public schema:', tables);

    /*
      🔴 THIS WAS A HAND-WRITTEN LIST OF EIGHT NAMES, and it printed
      "All 8 expected tables are present" while the migrations declare far more.
      A sanity check that congratulates you on a third of the schema is worse
      than none, because it gets read as coverage.

      Derived instead from the file just applied, which is the only thing this
      run can honestly speak for: apply 012 and it checks `access_requests`;
      apply an ADD COLUMN migration and it correctly claims nothing. Whether the
      CLUSTER matches every migration is `npm run verify:schema`'s question, and
      it asks about columns and readability too.
    */
    const expected = declaredTables([sql]);
    const missing = expected.filter((t) => !tables.includes(t));

    if (expected.length === 0) {
      console.log(
        `[migrate] ${SQL_FILENAME} declares no new tables — nothing to sanity-check here. ` +
          'Run `npm run verify:schema` to compare columns across both regions.',
      );
    } else if (missing.length > 0) {
      console.warn('[migrate] WARNING: tables declared by this migration not found:', missing);
    } else {
      console.log(
        `[migrate] All ${expected.length} table(s) declared by ${SQL_FILENAME} are present. ✓`,
      );
    }
  } catch (err) {
    console.error('[migrate] ERROR during migration:', err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('[migrate] Connection closed.');
  }
}

migrate().catch((err) => {
  console.error('[migrate] Unexpected error:', err);
  process.exit(1);
});
