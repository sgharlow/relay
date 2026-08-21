/**
 * Append-only, hash-chained audit log (Requirement 8).
 *
 * Every owner has an independent chain. For each new entry:
 *   seq        = (max seq for owner) + 1, or 0 for the first entry
 *   prev_hash  = entry_hash of the prior entry, or '0'.repeat(64) for the first
 *   entry_hash = SHA-256(prev_hash || canonicalJson(payload))
 *
 * The table is INSERT-only — no UPDATE or DELETE is ever issued.
 *
 * 🔴 HOW CONCURRENT WRITERS ARE SERIALISED, CORRECTED 2026-08-21. This
 * paragraph read: *"The read of MAX(seq)/prev_hash and the INSERT run inside
 * the same `withOccRetry` block so two concurrent writers for one owner
 * serialize via SQLSTATE 40001 retry."* That was false in both halves. The two
 * statements are separate autocommits on a pool — there is no BEGIN anywhere in
 * this repo — and two INSERTs of DIFFERENT primary keys do not conflict under
 * snapshot isolation, so nothing ever raised 40001 and `withOccRetry` had
 * nothing to retry. `lib/auth/signin-attempts.ts` already stated the truth
 * about the same engine and the two headers contradicted each other for weeks.
 *
 * What serialises them now is the primary key. `id` is DERIVED from
 * `(owner_id, seq)` (`auditEntryId`), so two writers that both read head N
 * collide on ONE ROW — a write-write conflict DSQL does detect. The loser is
 * refused (duplicate key, or 40001) and takes the next seq. The fork it
 * prevents was not data loss: `verifyAuditChain` reports two rows at one seq as
 * `prev_hash_mismatch` FOREVER, so an ordinary race made the tamper-evident log
 * accuse the product of tampering, on an append-only table with no repair path.
 *
 * `canonicalJson` deterministically serialises an entry with recursively sorted
 * object keys and EXCLUDES the chain columns (`prev_hash`, `entry_hash`) so that
 * recomputing `SHA-256(prev_hash + canonicalJson(row))` over a persisted row
 * reproduces the stored `entry_hash` (chain-verification path, Property 16).
 *
 * Audit writes intentionally BLOCK the triggering operation: a failure after
 * retries throws `AuditWriteError`, which release-critical callers surface as a
 * 503 rather than proceeding without a durable record (Requirement 8.5).
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.1–8.7
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { GENESIS_PREV_HASH, auditEntryId, canonicalJson, sha256 } from './chain';

// Re-exported for callers/tests that imported these from audit-service.
export { canonicalJson, sha256 } from './chain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Caller-supplied fields for a new audit entry. */
export interface AuditEntryInput {
  /** 'owner:<id>' | 'recipient:<id>' | 'system' | 'cron' */
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}

/** A persisted audit row as returned by `getAuditLog`. */
export interface AuditEntry {
  id: string;
  owner_id: string;
  seq: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
  ts: string;
}

/** Thrown when an audit entry cannot be durably written after all retries. */
export class AuditWriteError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AuditWriteError';
    Object.setPrototypeOf(this, AuditWriteError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WRITE_ATTEMPTS = 3;
const WRITE_RETRY_BASE_MS = 500;

/**
 * How many times one append may lose the race for a seq before giving up.
 *
 * No backoff, deliberately. A duplicate key here is not a transient condition
 * to wait out — it means another writer has ALREADY committed at that seq, so
 * the very next head read sees it and the retry succeeds immediately. Sleeping
 * would only widen the window for a third writer.
 */
const MAX_SEQ_COLLISIONS = 5;

/** Duplicate primary key. `pg` surfaces the SQLSTATE as `err.code`. */
function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>).code === '23505'
  );
}

// ---------------------------------------------------------------------------
// writeAuditEntry
// ---------------------------------------------------------------------------

/**
 * Appends a hash-chained entry to the owner's audit log and returns the
 * persisted row. Reads the chain head and inserts in one OCC-retried block.
 *
 * @throws {AuditWriteError} after {@link MAX_WRITE_ATTEMPTS} failed attempts.
 */
export async function writeAuditEntry(
  ownerId: string,
  entry: AuditEntryInput,
): Promise<AuditEntry> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      return await withOccRetry(() => appendOnce(ownerId, entry));
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_WRITE_ATTEMPTS - 1) {
        await sleep(WRITE_RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }

  /*
    Req 8.7 asks for two things on exhaustion: BLOCK the operation, and alert an
    operator. The block is real — `AuditWriteError` surfaces as a 503 upstream
    and the release subsystem refuses to proceed.

    ⚠️ THE SECOND HALF IS NOT AN ALARM, and this comment used to imply it was by
    calling the line below an "operator alert". It is a stderr write into Vercel
    runtime logs, which retain about 24 hours and which nobody reads
    (`ratified.csp-enforce-the-safe-four` / deferred D9 recorded exactly that).
    The ALARM OF RECORD is the three off-platform GitHub monitors named in
    `lib/ops/incident.ts` (B6, ratified 2026-08-20), and none of them observes
    audit-write failure.

    So what an operator actually gets is the BLOCK: a sustained failure here
    presents as every release action returning 503, which a customer reports and
    the production canary can see. That is the honest description, recorded here
    2026-08-21 rather than left as a comment claiming a channel that does not
    exist.

    NOT routed through `reportIncident()`. That would import the mail stack into
    the writer every other module calls — including the notify paths — to send
    an advisory email on the one code path already known to be failing, through
    the channel B6 classifies as advisory anyway. Making this a real alarm means
    a fourth GitHub monitor, off-platform, which is an ops change and not a
    change to this file.
  */
  process.stderr.write(
    `[audit] FATAL: failed to write audit entry for owner ${ownerId} after ` +
      `${MAX_WRITE_ATTEMPTS} attempts: ${String(lastErr)}\n`,
  );
  throw new AuditWriteError(
    `Audit write failed after ${MAX_WRITE_ATTEMPTS} attempts`,
    lastErr,
  );
}

async function appendOnce(
  ownerId: string,
  entry: AuditEntryInput,
): Promise<AuditEntry> {
  const detail = entry.detail ?? {};
  const entityId = entry.entityId ?? null;

  for (let collision = 0; collision < MAX_SEQ_COLLISIONS; collision++) {
    const head = await query<{ seq: string | number; entry_hash: string }>(
      `SELECT seq, entry_hash FROM audit_log
         WHERE owner_id = $1
         ORDER BY seq DESC
         LIMIT 1`,
      [ownerId],
    );

    const hasPrev = head.rowCount !== 0 && head.rows.length > 0;
    const seq = hasPrev ? Number(head.rows[0].seq) + 1 : 0;
    const prevHash = hasPrev ? head.rows[0].entry_hash : GENESIS_PREV_HASH;

    const ts = new Date().toISOString();

    // The exact object that is hashed. `canonicalJson` drops the chain columns,
    // so a verifier reading the stored row recomputes the same digest.
    const payload = {
      seq,
      owner_id: ownerId,
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entity_id: entityId,
      detail,
      ts,
    };
    const entryHash = sha256(prevHash + canonicalJson(payload));

    // Derived, not random. This is the whole concurrency defence — see
    // `auditEntryId`. Two writers holding the same head compute the same key
    // and collide on one row instead of both landing.
    const id = auditEntryId(ownerId, seq);

    try {
      await query<AuditEntry>(
        `INSERT INTO audit_log
           (id, owner_id, seq, actor, action, entity, entity_id, detail, prev_hash, entry_hash, ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          ownerId,
          seq,
          entry.actor,
          entry.action,
          entry.entity,
          entityId,
          JSON.stringify(detail),
          prevHash,
          entryHash,
          ts,
        ],
      );
      return normaliseRow(id, payload, prevHash, entryHash);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;

      // Somebody already holds this seq. Two possibilities, and they need
      // opposite handling — so ask the row rather than guessing.
      const existing = await query<{ entry_hash: string }>(
        `SELECT entry_hash FROM audit_log WHERE id = $1 LIMIT 1`,
        [id],
      );

      if (existing.rows[0]?.entry_hash === entryHash) {
        // It is OUR OWN statement, landed and then replayed. `query()` in
        // lib/db/connection.ts retries a connection error against the SECONDARY
        // pool with identical SQL, and ECONNRESET/ETIMEDOUT can arrive after the
        // statement committed. Appending a second entry here would put a
        // fabricated duplicate event into a log whose entire value is being
        // trusted about what happened — so the write is reported as the success
        // it already was.
        return normaliseRow(id, payload, prevHash, entryHash);
      }

      // A different writer won this seq. Re-read the head and take the next one.
    }
  }

  throw new Error(
    `Audit append for owner ${ownerId} lost ${MAX_SEQ_COLLISIONS} consecutive seq races`,
  );
}

/**
 * Builds the `AuditEntry` from the values that were hashed.
 *
 * It no longer reads a `RETURNING` row. It used to, to recover the
 * server-generated `id` — and only that; every other field was already taken
 * from the payload because the driver may hand back `seq` as a BIGINT string
 * and `detail` as an object or a JSON string. Now that `id` is derived from
 * `(owner_id, seq)` the caller knows it before the statement runs, so there is
 * nothing left to read back, and the duplicate-key branch can return the same
 * shape without a second round trip.
 */
function normaliseRow(
  id: string,
  payload: { seq: number; owner_id: string; actor: string; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; ts: string },
  prevHash: string,
  entryHash: string,
): AuditEntry {
  return {
    id,
    owner_id: payload.owner_id,
    seq: payload.seq,
    actor: payload.actor,
    action: payload.action,
    entity: payload.entity,
    entity_id: payload.entity_id,
    detail: payload.detail,
    prev_hash: prevHash,
    entry_hash: entryHash,
    ts: payload.ts,
  };
}

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------

/** Returns the owner's audit entries ordered by ascending `seq`. */
export async function getAuditLog(ownerId: string): Promise<AuditEntry[]> {
  const result = await query<AuditEntry>(
    `SELECT id, owner_id, seq, actor, action, entity, entity_id, detail, prev_hash, entry_hash, ts
       FROM audit_log
       WHERE owner_id = $1
       ORDER BY seq ASC`,
    [ownerId],
  );
  return result.rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
