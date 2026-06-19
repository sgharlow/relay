/**
 * Vault item validation + persistence (Requirement 1).
 *
 * Route handlers stay thin and delegate here so the validation and SQL mapping
 * are testable without a running server (mirrors lib/db, lib/audit conventions).
 *
 * Storage notes:
 *  - `ciphertext` and `wrapped_data_key` are BYTEA columns; they arrive from the
 *    browser as base64 strings, are stored as Buffers, and are returned as
 *    base64 strings. The server never decrypts.
 *  - The IV is prepended to the ciphertext by the client (see lib/crypto), so
 *    there is no separate `iv` column.
 *  - List queries return a metadata-only projection — never ciphertext or
 *    wrapped_data_key (Requirement 1, ZK-preserving list view).
 *
 * Feature: relay-h0-mvp
 * Requirements: 1.1–1.8
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { cascadeDelete } from '../db/integrity';

// Allowed enumerations (pg-free, in lib/domain/enums) — re-exported for callers.
import {
  VALID_TYPES,
  VALID_CATEGORIES,
  VALID_CRITICALITY,
  type VaultItemType,
} from '../domain/enums';

export { VALID_TYPES, VALID_CATEGORIES, VALID_CRITICALITY, type VaultItemType };

const TITLE_MAX = 200;
const URL_MAX = 2048;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw create payload from POST /api/vault/items (base64 crypto fields). */
export interface CreateVaultItemInput {
  type: VaultItemType;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  criticality: string | null;
  ciphertext: string; // base64
  wrapped_data_key: string; // base64
  kms_key_id: string;
}

/** Non-secret metadata projection (list view + create/update response). */
export interface VaultItemMetadata {
  id: string;
  type: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  criticality: string | null;
  is_root_credential: boolean;
  recurring_billing: boolean;
  irreplaceable: boolean;
  importance_score: number;
  depends_on_item_id: string | null;
  backup_note: string | null;
  created_at: string;
  updated_at: string;
}

/** Full item including the (base64) encrypted payload — owner edit/decrypt view. */
export interface FullVaultItem extends VaultItemMetadata {
  ciphertext: string; // base64
  wrapped_data_key: string; // base64
  kms_key_id: string;
}

/** Update payload — re-encrypted ciphertext + wrapped key (Requirement 1.6). */
export interface UpdateVaultItemInput {
  ciphertext: string; // base64
  wrapped_data_key: string; // base64
  kms_key_id?: string;
}

/** Thrown on validation failure; routes map this to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isBase64(v: string): boolean {
  // Accept standard base64 (the client uses btoa). Empty already excluded.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length % 4 === 0;
}

/**
 * Validates and normalises a create payload.
 * @throws {ValidationError} on the first invalid field; nothing is persisted.
 */
export function validateCreateInput(body: unknown): CreateVaultItemInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  // type — invalid types are always rejected (Property 2, Requirement 1.3)
  if (!isNonEmptyString(b.type) || !VALID_TYPES.includes(b.type as VaultItemType)) {
    throw new ValidationError(
      `type must be one of: ${VALID_TYPES.join(', ')}`,
      'type',
    );
  }

  // title — 1..200 chars (Requirement 1.4)
  if (!isNonEmptyString(b.title) || b.title.length > TITLE_MAX) {
    throw new ValidationError(`title must be 1–${TITLE_MAX} characters`, 'title');
  }

  // url — optional, ≤ 2048 chars
  if (b.url != null) {
    if (typeof b.url !== 'string' || b.url.length > URL_MAX) {
      throw new ValidationError(`url must be ≤ ${URL_MAX} characters`, 'url');
    }
  }

  // category — optional, constrained
  if (b.category != null && !VALID_CATEGORIES.includes(b.category as never)) {
    throw new ValidationError(
      `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
      'category',
    );
  }

  // criticality — optional, constrained
  if (b.criticality != null && !VALID_CRITICALITY.includes(b.criticality as never)) {
    throw new ValidationError(
      `criticality must be one of: ${VALID_CRITICALITY.join(', ')}`,
      'criticality',
    );
  }

  // encrypted payload — required, base64
  for (const field of ['ciphertext', 'wrapped_data_key'] as const) {
    if (!isNonEmptyString(b[field]) || !isBase64(b[field] as string)) {
      throw new ValidationError(`${field} must be a non-empty base64 string`, field);
    }
  }
  if (!isNonEmptyString(b.kms_key_id)) {
    throw new ValidationError('kms_key_id is required', 'kms_key_id');
  }

  return {
    type: b.type as VaultItemType,
    title: b.title as string,
    service_name: (b.service_name as string | undefined) ?? null,
    url: (b.url as string | undefined) ?? null,
    category: (b.category as string | undefined) ?? null,
    criticality: (b.criticality as string | undefined) ?? null,
    ciphertext: b.ciphertext as string,
    wrapped_data_key: b.wrapped_data_key as string,
    kms_key_id: b.kms_key_id as string,
  };
}

/** Validates an update payload (re-encrypted blob). */
export function validateUpdateInput(body: unknown): UpdateVaultItemInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  for (const field of ['ciphertext', 'wrapped_data_key'] as const) {
    if (!isNonEmptyString(b[field]) || !isBase64(b[field] as string)) {
      throw new ValidationError(`${field} must be a non-empty base64 string`, field);
    }
  }
  return {
    ciphertext: b.ciphertext as string,
    wrapped_data_key: b.wrapped_data_key as string,
    kms_key_id: isNonEmptyString(b.kms_key_id) ? (b.kms_key_id as string) : undefined,
  };
}

// ---------------------------------------------------------------------------
// SQL projections + row mapping
// ---------------------------------------------------------------------------

const METADATA_COLUMNS =
  'id, type, title, service_name, url, category, criticality, ' +
  'is_root_credential, recurring_billing, irreplaceable, importance_score, ' +
  'depends_on_item_id, backup_note, created_at, updated_at';

function toMetadata(row: Record<string, unknown>): VaultItemMetadata {
  return {
    id: String(row.id),
    type: String(row.type),
    title: String(row.title),
    service_name: (row.service_name as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    criticality: (row.criticality as string | null) ?? null,
    is_root_credential: Boolean(row.is_root_credential),
    recurring_billing: Boolean(row.recurring_billing),
    irreplaceable: Boolean(row.irreplaceable),
    importance_score: Number(row.importance_score),
    depends_on_item_id: (row.depends_on_item_id as string | null) ?? null,
    backup_note: (row.backup_note as string | null) ?? null,
    created_at: stringifyTs(row.created_at),
    updated_at: stringifyTs(row.updated_at),
  };
}

function stringifyTs(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** BYTEA → base64. pg returns BYTEA as a Buffer. */
function byteaToBase64(v: unknown): string {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  // Already a string (e.g. mocked) — assume base64.
  return String(v);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Lists an owner's items (metadata only), most-important first. */
export async function listItems(ownerId: string): Promise<VaultItemMetadata[]> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `SELECT ${METADATA_COLUMNS}
         FROM vault_items
        WHERE owner_id = $1
        ORDER BY is_root_credential DESC, importance_score DESC, title ASC`,
      [ownerId],
    ),
  );
  return result.rows.map(toMetadata);
}

/** Creates an item for the owner and returns its metadata projection. */
export async function createItem(
  ownerId: string,
  input: CreateVaultItemInput,
): Promise<VaultItemMetadata> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `INSERT INTO vault_items
         (owner_id, type, title, service_name, url, category, criticality,
          ciphertext, wrapped_data_key, kms_key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${METADATA_COLUMNS}`,
      [
        ownerId,
        input.type,
        input.title,
        input.service_name,
        input.url,
        input.category,
        input.criticality,
        Buffer.from(input.ciphertext, 'base64'),
        Buffer.from(input.wrapped_data_key, 'base64'),
        input.kms_key_id,
      ],
    ),
  );
  return toMetadata(result.rows[0]);
}

/**
 * Fetches one full item (including base64 ciphertext) scoped to the owner.
 * Returns null when the row does not exist OR belongs to another owner — the
 * caller maps both to the same 403 so existence is not revealed (Requirement 1.8).
 */
export async function getItemForOwner(
  ownerId: string,
  id: string,
): Promise<FullVaultItem | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `SELECT ${METADATA_COLUMNS}, ciphertext, wrapped_data_key, kms_key_id
         FROM vault_items
        WHERE id = $1 AND owner_id = $2
        LIMIT 1`,
      [id, ownerId],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    ...toMetadata(row),
    ciphertext: byteaToBase64(row.ciphertext),
    wrapped_data_key: byteaToBase64(row.wrapped_data_key),
    kms_key_id: String(row.kms_key_id),
  };
}

/**
 * Replaces the encrypted payload and bumps updated_at (Requirement 1.6).
 * The WHERE clause is owner-scoped as defence-in-depth. Returns the updated
 * metadata, or null if no owner-scoped row matched.
 */
export async function updateItem(
  ownerId: string,
  id: string,
  input: UpdateVaultItemInput,
): Promise<VaultItemMetadata | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE vault_items
          SET ciphertext = $1,
              wrapped_data_key = $2,
              kms_key_id = COALESCE($3, kms_key_id),
              updated_at = now()
        WHERE id = $4 AND owner_id = $5
       RETURNING ${METADATA_COLUMNS}`,
      [
        Buffer.from(input.ciphertext, 'base64'),
        Buffer.from(input.wrapped_data_key, 'base64'),
        input.kms_key_id ?? null,
        id,
        ownerId,
      ],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toMetadata(result.rows[0]);
}

/**
 * Cascade-deletes the item's access_rules, then the item itself
 * (Requirement 1.7 — DSQL has no ON DELETE CASCADE). Owner-scoped.
 */
export async function deleteItem(ownerId: string, id: string): Promise<void> {
  // Access rules first so none is ever orphaned mid-delete. Ownership of the
  // item is asserted by the route before this runs.
  await cascadeDelete('access_rules', id, 'vault_item_id');
  await withOccRetry(() =>
    query(`DELETE FROM vault_items WHERE id = $1 AND owner_id = $2`, [id, ownerId]),
  );
}
