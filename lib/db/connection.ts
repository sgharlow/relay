/**
 * Multi-region Aurora DSQL connection manager.
 *
 * Maintains two pg.Pool instances (primary + secondary).  Pool selection order:
 *  1. If DSQL_USE_SECONDARY=true → always use secondary (demo failover switch)
 *  2. If primary is unhealthy (within the 60-second unhealthy window) → use secondary
 *  3. If primaryPool.totalCount === 0 → use secondary (pool not yet established)
 *  4. Otherwise → use primary
 *
 * On a connection error inside query(), the primary is marked unhealthy so
 * SUBSEQUENT requests route to the secondary. The STATEMENT is replayed there
 * only when replaying it is safe — a read, or an error that proves the
 * statement never left. See `isPreSendConnectError`.
 *
 * ⚠️ This read *"the request is retried once against the secondary pool"*
 * until 2026-08-21, which is what the code did and what was wrong with it: a
 * WRITE that met a mid-flight reset was re-issued against a peer that had
 * already applied it. The blanket sentence outlived the blanket behaviour by
 * the length of one file — the correction was written 200 lines below and this
 * summary, the part a reader meets first, still described the defect as the
 * design. Corrected here the same day.
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

/**
 * Which database role to connect as, and therefore which kind of token to mint.
 *
 * 🔴 THIS EXISTS BECAUSE RELAY HAD ONE CREDENTIAL AND IT WAS ROOT. Until
 * 2026-08-15 this module called `getDbConnectAdminAuthToken()` unconditionally,
 * so the live production app connected as `admin` holding full DDL rights — it
 * could DROP TABLE — and the IAM user carrying that power, `relay-runtime`, was
 * the very same user whose access key sat in `.env.local` on a laptop. There was
 * no layer, in IAM or in the database, at which the deployed product and a
 * developer's machine could be told apart.
 *
 * Steve's ruling: only a sysadmin should be able to write outside the product's
 * own features and APIs. There is one cluster, and there will be one cluster
 * until G1 is decided, so the separation is built from identity and privilege
 * instead of environments.
 *
 * The two halves are inseparable, which is why this returns both. A custom role
 * REQUIRES the non-admin token: `dsql:DbConnect` mints credentials that cannot
 * authenticate as `admin` at all, so this is a wall rather than a convention —
 * the credential is incapable of the thing, not merely discouraged from it.
 *
 * ⚠️ UNSET MEANS ADMIN — a LOCAL affordance, not the production state.
 *
 * This paragraph read *"Production still runs on the admin path; … Production
 * moves when somebody sets the variable"* until 2026-08-21. That was true for
 * one day. Production moved on 2026-08-16: `DSQL_ROLE=relay_app` is set in
 * Vercel and `dsql:DbConnectAdmin` was stripped from `relay-runtime-policy`
 * (v2; v1 retained as the rollback). The comment on the function that CHOOSES
 * the production identity was the last place still describing the before.
 *
 * The consequence of believing it is not academic. With the grant stripped, an
 * unset `DSQL_ROLE` no longer means "admin, as always" — it means the live site
 * mints an admin token it is not permitted to obtain and cannot connect at all.
 * `lib/ops/iam-wall.ts` names the same hazard from the other direction.
 *
 * Both halves are re-measurable rather than remembered: `npm run verify:roles`
 * for the database wall, `npm run verify:iam` for the IAM wall.
 */
export function dsqlIdentity(): { user: string; admin: boolean } {
  const role = process.env.DSQL_ROLE?.trim();
  if (!role || role === 'admin') return { user: 'admin', admin: true };
  return { user: role, admin: false };
}

function makeDsqlPool(host: string): pg.Pool {
  const signer = new DsqlSigner({ hostname: host, region: dsqlRegion(host) });
  const { user, admin } = dsqlIdentity();
  return new pg.Pool({
    ...POOL_CONFIG,
    host,
    user,
    ssl: { rejectUnauthorized: sslRejectUnauthorized() },
    password: async () =>
      admin ? signer.getDbConnectAdminAuthToken() : signer.getDbConnectAuthToken(),
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

/*
  Connection errors come in two kinds and they must NOT be treated alike.

  🔴 UNTIL 2026-08-21 THEY WERE. One predicate covered both, and `query()`
  re-issued the IDENTICAL SQL against the secondary for any of them. But
  ECONNRESET and a socket ETIMEDOUT can arrive AFTER the statement was sent and
  committed, and the two endpoints are one logical cluster — the runbook says so
  ("Regions are one logical cluster. A DELETE replicates to the peer"), and the
  2026-08-20 close-out recorded the secondary already holding the primary's DDL.
  So the replay landed on the same data: a duplicate contact or vault item, a
  denial counted twice toward the halt threshold, a second audit row at the same
  seq.

  It failed in the flattering direction. The scenario the retry exists for — a
  wobbling primary connection — is exactly the scenario in which the write has
  already happened.

  ⚠️ AND IT IS NOT PURE UPSIDE — say so, because the next reader will meet the
  consequence before they meet the argument. A write that meets a reset or a
  socket timeout mid-flight now surfaces to the caller: `withOccRetry` only
  retries SQLSTATE 40001, so nothing above absorbs it and the request that
  previously returned 200 (having possibly written twice) returns 500. That is
  a real, user-visible availability loss, and it falls in exactly the
  primary-wobble window the failover was built for. It is the right trade —
  a visible failure the caller can retry beats a silent duplicate in a
  hash-chained audit log — but it is a trade, not a free correction.
*/

/**
 * POST-SEND-POSSIBLE: the socket died and we cannot know whether the server
 * applied the statement. The primary is still marked unhealthy — so the next
 * call rotates and the failover story holds — but the statement itself is only
 * replayed when it is a read.
 *
 * Declared FIRST because it is the stronger signal: an errno set by the socket
 * layer is evidence about what happened on the wire, where a message match is a
 * guess about which library raised it. `isPreSendConnectError` defers to it.
 */
function isPostSendConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT';
}

/**
 * PRE-SEND: the connection was never established, so the statement provably did
 * not run. Replaying it is an at-most-once write, and this is the failover the
 * demo switch and the runbook rely on.
 */
function isPreSendConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  /*
    🔴 THE ERRNO WINS OVER THE MESSAGE, AND UNTIL 2026-08-21 IT DID NOT.
    This predicate matched on message as well as code, and `query()` asked it
    FIRST — so an error carrying `code: 'ETIMEDOUT'` whose text contained
    "connection timeout" was ruled pre-send and a WRITE was replayed on the
    secondary regardless. ETIMEDOUT is one of the two codes the split names as
    post-send-possible; for that code the split changed nothing, and the
    repo's own tests build exactly that object (`connection.test.ts`, the
    ETIMEDOUT cases) — they passed only because they issue `SELECT 1`, where
    both branches replay and neither predicate is observable.

    The guard belongs here, not at the call site: any future caller that asks
    "was this pre-send?" gets the same answer, and there is no ordering rule
    for a reader to remember. A socket errno is only ever ambiguous in the
    direction of caution — a `connect ETIMEDOUT` really is pre-send, and
    calling it post-send costs one replayed READ, not a duplicated write.
  */
  if (isPostSendConnectionError(err)) return false;

  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message.toLowerCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    // pg-pool raises both of these when `connectionTimeoutMillis` expires, with
    // NO `code` property (see node_modules/pg-pool/index.js — 'timeout exceeded
    // when trying to connect' and 'Connection terminated due to connection
    // timeout'). They are the reason the message arm is kept rather than
    // deleted: without it a real connect timeout stops failing over.
    msg.includes('connection timeout') ||
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('connect econnrefused') ||
    msg.includes('connection refused')
  );
}

/**
 * Idempotent by construction, so a replay cannot change anything.
 *
 * A data-modifying CTE would have to begin with `WITH`, which this does not
 * match — so "starts with SELECT" is a sufficient test rather than an
 * optimistic one.
 */
function isReplayableRead(sql: string): boolean {
  return /^\s*SELECT\b/i.test(sql);
}

// ---------------------------------------------------------------------------
// Public query wrapper
// ---------------------------------------------------------------------------

/**
 * Executes a parameterised SQL query against the currently active pool.
 *
 * On a connection-level error the primary pool is marked unhealthy, so this and
 * subsequent requests inside the 60-second window route to the secondary. The
 * STATEMENT is replayed on the secondary only when replaying it is safe: the
 * connection never opened (so it provably did not run), or it is a read. A
 * write that met a reset mid-flight is surfaced to the caller instead, because
 * the caller — `withOccRetry`, an intent-read, a CAS on `version` — is the
 * layer that knows whether repeating it is sound. See `isPreSendConnectError`.
 *
 * Query-level errors (constraint violations, SQLSTATE 40001) are NOT retried
 * here — callers handle those.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const pool = getPool();

  try {
    return await pool.query<T>(sql, params);
  } catch (err) {
    const preSend = isPreSendConnectError(err);
    if (!preSend && !isPostSendConnectionError(err)) throw err;

    // Rotate to secondary for subsequent requests within the window.
    markPrimaryUnhealthy();

    if (preSend || isReplayableRead(sql)) {
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
