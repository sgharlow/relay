/**
 * Append-only, hash-chained audit log (Requirement 8).
 *
 * Every owner has an independent chain. For each new entry:
 *   seq        = (max seq for owner) + 1, or 0 for the first entry
 *   prev_hash  = entry_hash of the prior entry, or '0'.repeat(64) for the first
 *   entry_hash = SHA-256(prev_hash || canonicalJson(payload))
 *
 * The table is INSERT-only — no UPDATE or DELETE is ever issued. The read of
 * MAX(seq)/prev_hash and the INSERT run inside the same `withOccRetry` block so
 * two concurrent writers for one owner serialize via SQLSTATE 40001 retry.
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
import { GENESIS_PREV_HASH, canonicalJson, sha256 } from './chain';

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

  // Operator alert — the release subsystem treats this as fatal (503 upstream).
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
  const detail = entry.detail ?? {};
  const entityId = entry.entityId ?? null;

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

  const inserted = await query<AuditEntry>(
    `INSERT INTO audit_log
       (owner_id, seq, actor, action, entity, entity_id, detail, prev_hash, entry_hash, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, owner_id, seq, actor, action, entity, entity_id, detail, prev_hash, entry_hash, ts`,
    [
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

  return normaliseRow(inserted.rows[0], payload, prevHash, entryHash);
}

/**
 * The `RETURNING` row may come back with `seq` as a string (BIGINT) and
 * `detail` as an object or JSON string depending on driver config. Normalise to
 * the `AuditEntry` shape, falling back to the values we just computed.
 */
function normaliseRow(
  row: AuditEntry | undefined,
  payload: { seq: number; owner_id: string; actor: string; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; ts: string },
  prevHash: string,
  entryHash: string,
): AuditEntry {
  return {
    id: row?.id ?? '',
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
