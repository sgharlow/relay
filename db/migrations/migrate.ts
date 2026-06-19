/**
 * db/migrations/migrate.ts
 *
 * Applies the 001_initial.sql DDL migration against an Aurora DSQL endpoint.
 *
 * Usage:
 *   npx tsx db/migrations/migrate.ts                        # applies 001_initial.sql (default)
 *   npx tsx db/migrations/migrate.ts 002_unique_auth_sub.sql  # applies a specific migration
 *
 * Migrations are NOT tracked in a table; pass the file you intend to apply.
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

if (!PASSWORD) {
  console.error(
    '[migrate] ERROR: DSQL_PASSWORD environment variable is not set.\n' +
      '  For IAM authentication, generate a token with:\n' +
      '    aws dsql generate-db-connect-auth-token \\\n' +
      '      --hostname $DSQL_PRIMARY_ENDPOINT \\\n' +
      '      --region us-east-1',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read SQL file — defaults to 001_initial.sql; pass a filename to apply another.
// ---------------------------------------------------------------------------
const SQL_FILENAME = process.argv[2] ?? '001_initial.sql';
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
    password: PASSWORD,
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

    console.log(`[migrate] Applying ${SQL_FILENAME} ...`);
    await client.query(sql);
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

    const EXPECTED_TABLES = [
      'access_rules',
      'audit_log',
      'recipients',
      'release_state',
      'users',
      'vault_items',
      'verifier_confirmations',
      'verifiers',
    ];

    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      console.warn('[migrate] WARNING: expected tables not found:', missing);
    } else {
      console.log('[migrate] All 8 expected tables are present. ✓');
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
