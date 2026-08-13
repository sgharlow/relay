/**
 * Multi-region Aurora DSQL connection manager.
 *
 * Maintains two pg.Pool instances (primary + secondary).  Pool selection order:
 *  1. If DSQL_USE_SECONDARY=true → always use secondary (demo failover switch)
 *  2. If primary is unhealthy (within the 60-second unhealthy window) → use secondary
 *  3. If primaryPool.totalCount === 0 → use secondary (pool not yet established)
 *  4. Otherwise → use primary
 *
 * On a connection error inside query(), the primary is marked unhealthy and the
 * request is retried once against the secondary pool.
 *
 * Feature: relay-h0-mvp
 * Requirements: 14.2, 14.3
 */

import pg from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

// ---------------------------------------------------------------------------
// Pool configuration
// ---------------------------------------------------------------------------

/**
 * Whether the DB connection verifies the server's certificate.
 *
 * 🔴 THIS WAS HARDCODED `false` UNTIL 2026-08-13, found by the pre-release
 * audit. Every ciphertext, wrapped data key, IAM auth token and audit-chain
 * hash crosses the public internet from Vercel to AWS on this connection, and
 * it would have accepted any certificate presented to it. The product's promise
 * is that plaintext never leaves the browser — that promise holds, but the
 * envelope around it is only as good as the channel carrying it.
 *
 * THE ASYMMETRY IS WHAT GAVE IT AWAY. `db/migrations/migrate.ts` — the one-off
 * admin tool in this same repo — already defaults to `true` and documents
 * `false` as local-only. The tool somebody runs by hand was hardened; the path
 * that runs on every request was not.
 *
 * DEFAULTS ON, and the default is proven rather than assumed: both endpoints
 * were probed with verification enabled before this changed, and both reported
 * `authorized=true` against a `*.dsql.<region>.on.aws` certificate issued by
 * "Amazon RSA 2048 M04" — a publicly-trusted chain already in Node's bundled
 * root store. No CA bundle is needed, and none is configured; adding one would
 * be a second thing to keep current for no gain.
 *
 * The escape hatch exists so that rollback is an environment variable rather
 * than a redeploy. Setting it to `false` restores the old behaviour in under a
 * minute — which is the only reason it was safe to change a working system's
 * database connection at all. Name and semantics match migrate.ts deliberately:
 * one variable, one meaning, both sides of the repo.
 *
 * READ AT POOL CONSTRUCTION, not at import. Pools initialise lazily here for
 * exactly this class of reason, and `getPool()` already reads
 * DSQL_USE_SECONDARY per call — an env read frozen at module load would be the
 * odd one out, and would make the setting untestable without module surgery.
 */
export function sslRejectUnauthorized(): boolean {
  return process.env.DSQL_SSL_REJECT_UNAUTHORIZED !== 'false';
}

const POOL_CONFIG: Omit<pg.PoolConfig, 'host' | 'ssl'> = {
  port: 5432,
  database: 'postgres',
  user: 'admin',
  connectionTimeoutMillis: 5000,   // 5-second connection timeout (Req 14.2)
  idleTimeoutMillis: 30_000,
  max: 10,
};

// Aurora DSQL authenticates with short-lived IAM auth tokens, not static
// passwords. We mint one per new connection via the DSQL signer; pg accepts an
// async `password` function and refreshes it automatically as connections are
// (re)established. The signer's region is derived from the endpoint hostname
// (`<cluster-id>.dsql.<region>.on.aws`). Without this the deployed app cannot
// authenticate to DSQL at all (every query fails).
function dsqlRegion(host: string): string {
  const m = host.match(/\.dsql\.([a-z0-9-]+)\.on\.aws$/i);
  return m ? m[1] : (process.env.AWS_REGION ?? 'us-east-1');
}

function makeDsqlPool(host: string): pg.Pool {
  const signer = new DsqlSigner({ hostname: host, region: dsqlRegion(host) });
  return new pg.Pool({
    ...POOL_CONFIG,
    host,
    ssl: { rejectUnauthorized: sslRejectUnauthorized() },
    password: async () => signer.getDbConnectAdminAuthToken(),
  });
}

// Lazily initialise pools so that missing env vars don't crash at import time
// during tests that don't exercise DB code.
let _primaryPool: pg.Pool | null = null;
let _secondaryPool: pg.Pool | null = null;

function getPrimaryPool(): pg.Pool {
  if (!_primaryPool) {
    const host = process.env.DSQL_PRIMARY_ENDPOINT;
    if (!host) throw new Error('DSQL_PRIMARY_ENDPOINT is not set');
    _primaryPool = makeDsqlPool(host);
  }
  return _primaryPool;
}

function getSecondaryPool(): pg.Pool {
  if (!_secondaryPool) {
    const host = process.env.DSQL_SECONDARY_ENDPOINT;
    if (!host) throw new Error('DSQL_SECONDARY_ENDPOINT is not set');
    _secondaryPool = makeDsqlPool(host);
  }
  return _secondaryPool;
}

// ---------------------------------------------------------------------------
// Unhealthy-window tracking (60 seconds before re-checking primary)
// ---------------------------------------------------------------------------

const UNHEALTHY_WINDOW_MS = 60_000;

let primaryUnhealthyUntil = 0; // epoch ms; 0 means "not unhealthy"

/**
 * Mark the primary pool as unhealthy.  For the next 60 seconds all calls to
 * getPool() will return the secondary pool.
 */
export function markPrimaryUnhealthy(): void {
  primaryUnhealthyUntil = Date.now() + UNHEALTHY_WINDOW_MS;
}

/**
 * Returns true when the primary is currently inside its unhealthy window.
 */
export function isPrimaryUnhealthy(): boolean {
  if (primaryUnhealthyUntil === 0) return false;
  if (Date.now() >= primaryUnhealthyUntil) {
    primaryUnhealthyUntil = 0; // window expired — reset
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pool selector
// ---------------------------------------------------------------------------

/**
 * Returns the pool that should serve the current request.
 *
 * Decision order (first match wins):
 *  1. DSQL_USE_SECONDARY=true  → secondary  (demo failover env var)
 *  2. Primary is within unhealthy window → secondary
 *  3. Primary pool totalCount === 0 → secondary (pool not initialised / empty)
 *  4. Otherwise → primary
 */
export function getPool(): pg.Pool {
  if (process.env.DSQL_USE_SECONDARY === 'true') {
    return getSecondaryPool();
  }

  if (isPrimaryUnhealthy()) {
    return getSecondaryPool();
  }

  const primary = getPrimaryPool();
  if (primary.totalCount === 0) {
    return getSecondaryPool();
  }

  return primary;
}

// ---------------------------------------------------------------------------
// Connection-error helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for errors that indicate the underlying TCP connection or host
 * is unreachable — triggering a failover to the secondary pool.
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message.toLowerCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    msg.includes('connection timeout') ||
    msg.includes('connect econnrefused') ||
    msg.includes('connection refused')
  );
}

// ---------------------------------------------------------------------------
// Public query wrapper
// ---------------------------------------------------------------------------

/**
 * Executes a parameterised SQL query against the currently active pool.
 *
 * If a connection-level error is encountered (host unreachable, timeout, etc.)
 * the primary pool is marked unhealthy and the query is automatically retried
 * once against the secondary pool.  Query-level errors (e.g. constraint
 * violations, SQLSTATE 40001) are NOT retried here — callers handle those.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const pool = getPool();

  try {
    return await pool.query<T>(sql, params);
  } catch (err) {
    if (isConnectionError(err)) {
      // Rotate to secondary for this and subsequent requests within the window
      markPrimaryUnhealthy();
      const secondary = getSecondaryPool();
      return await secondary.query<T>(sql, params);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown helpers (used in tests and server teardown)
// ---------------------------------------------------------------------------

/**
 * Ends both pools and resets module-level state.  Safe to call even if pools
 * were never initialised.
 */
export async function closeAllPools(): Promise<void> {
  const closing: Promise<void>[] = [];
  if (_primaryPool) {
    closing.push(_primaryPool.end());
    _primaryPool = null;
  }
  if (_secondaryPool) {
    closing.push(_secondaryPool.end());
    _secondaryPool = null;
  }
  primaryUnhealthyUntil = 0;
  await Promise.all(closing);
}

/** Exposed for testing purposes only — resets the unhealthy window. */
export function resetUnhealthyState(): void {
  primaryUnhealthyUntil = 0;
}

/**
 * Exposed for testing purposes only.
 * Injects pre-built pool instances, bypassing the lazy Pool constructor path.
 * Pass `null` to clear an injected pool (reverts to lazy construction).
 */
export function _setPoolsForTesting(
  primary: pg.Pool | null,
  secondary: pg.Pool | null,
): void {
  _primaryPool = primary;
  _secondaryPool = secondary;
  primaryUnhealthyUntil = 0;
}
