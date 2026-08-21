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
import { byteaToBase64 } from '../db/bytea';
import { withOccRetry } from '../db/occ';
import { cascadeDelete } from '../db/integrity';

// Allowed enumerations (pg-free, in lib/domain/enums) — re-exported for callers.
import {
  VALID_TYPES,
  VALID_CATEGORIES,
  VALID_CRITICALITY,
  type VaultItemType,
} from '../domain/enums';
import { selected } from '../db/row';
import { parseKindList, serialiseFactorList } from './usability';

export { VALID_TYPES, VALID_CATEGORIES, VALID_CRITICALITY, type VaultItemType };

const TITLE_MAX = 200;
const URL_MAX = 2048;
/**
 * `backup_note` has no length CHECK in migration 001, so this is the only bound
 * on it. Generous, because the field's job is a plain-language explanation and a
 * cramped limit would push people back to writing nothing.
 */
export const BACKUP_NOTE_MAX = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw create payload from POST /api/vault/items (base64 crypto fields). */
export interface CreateVaultItemInput {
  /**
   * What the blob holds, declared by the browser that encrypted it (035).
   * Sorted-comma-joined. REQUIRED after validation: `validateCreateInput`
   * derives it via `requireSecretKinds` and refuses a write that omits it, so
   * a persisted new item always carries a declaration. `''` means "holds
   * nothing recognised"; only pre-035 historical rows are null in the column.
   */
  secret_kinds: string;
  type: VaultItemType;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  criticality: string | null;
  ciphertext: string; // base64
  wrapped_data_key: string; // base64
  kms_key_id: string;
  /**
   * The plain-language note a recipient reads — what this is for, or how to
   * find the original. Added 2026-08-17.
   *
   * 🔴 THE COLUMN EXISTED SINCE MIGRATION 001 AND NOTHING COULD WRITE IT.
   * `detectGaps` decides `CUSTODY_RISK` and `MISSING_NOTE` from this field, so
   * with no write path every item in every real vault carried a permanent gap
   * advising the owner to add a note the product offered no way to add. Only
   * `lib/seed/seed-runner.ts` set it, which is why the demo vault looked right.
   * `lib/ops/advice-inputs-writable.test.ts` is the guard.
   *
   * ⚠️ NOT SECRET, AND NOT ENCRYPTED. This is in `METADATA_COLUMNS`, so it is
   * stored as plaintext and it is one of the fields `getVaultMetadata` hands to
   * the AI agents. The secret itself goes in `ciphertext` and never leaves the
   * browser unencrypted. The UI has to say so, or people will put passwords
   * here — and that would put a plaintext secret on a server path, which is the
   * one thing the architecture exists to prevent.
   */
  backup_note: string | null;
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
  /** The owner's own answer, or null if they have never given one (Req 11.8). */
  owner_set_root?: boolean | null;
  /**
   * The owner's own answer to "could this be replaced?" — migration 034.
   *
   * Same three states and the same reason as `owner_set_root` above: yes, no,
   * or never asked. It exists because `irreplaceable` is what raises a
   * CUSTODY_RISK — the gap covering a deed, a will, a passport — and until now
   * only the intake agent could set it, from the title alone. An owner who knew
   * better had no way to say so, and writing `irreplaceable` directly would have
   * lasted exactly until the next analysis run.
   */
  owner_set_irreplaceable?: boolean | null;
  recurring_billing: boolean;
  irreplaceable: boolean;
  importance_score: number;
  depends_on_item_id: string | null;
  backup_note: string | null;
  /**
   * What the BLOB holds — client-declared, written by the browser that just
   * encrypted it (migration 035). `null` means no client has ever declared,
   * which `usability.ts` reads as `unknown` and NOT as "holds nothing".
   *
   * ⚠️ NEVER BACKFILLABLE. The server cannot read the ciphertext, so it cannot
   * know what an existing item holds; this is populated opportunistically the
   * next time an owner writes an item. An item last touched before 2026-08-18
   * and never edited again stays `unknown` forever, and `unknown` is the honest
   * answer for it.
   */
  secret_kinds?: string | null;
  /**
   * What the ACCOUNT demands at the door — owner-declared (migration 035).
   * `null` means nobody has ever asked. Same three states as `owner_set_root`
   * and `owner_set_irreplaceable`, and the same reason: the owner knows
   * something the server cannot infer.
   */
  factors_required?: string | null;
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
  /**
   * Renaming, added 2026-08-13. Optional throughout: a caller that sends only a
   * re-encrypted blob keeps the previous behaviour exactly, so this widens the
   * contract without changing it for anyone already using it.
   *
   * 🔴 THE TITLE WAS ALREADY BEING SENT AND SILENTLY DROPPED. `encryptForUpload`
   * builds its payload from the item metadata, so every update posted a title —
   * and `validateUpdateInput` picked out three fields and discarded the rest. An
   * owner could not correct a typo in the one field their family reads, and
   * nothing anywhere said why.
   */
  title?: string;
  service_name?: string | null;
  url?: string | null;
  /**
   * Same field as on create, and optional for the same reason as `title`: a
   * caller sending only a re-encrypted blob keeps its previous behaviour.
   *
   * ⚠️ SETTING WORKS, CLEARING DOES NOT — stated rather than hidden. The UPDATE
   * uses `COALESCE`, matching `title`, `service_name` and `url` exactly, so
   * omitting the field leaves the stored note alone. The consequence is that an
   * owner cannot blank a note once written, only replace it. Following the
   * module's existing pattern beat inventing a second one for a single field;
   * the limitation is recorded as debt in the sprint report rather than being
   * quietly shipped.
   */
  backup_note?: string;
  /**
   * What the RE-ENCRYPTED blob holds (035). REQUIRED, unlike everything else on
   * this interface — and NOT COALESCE'd in the UPDATE.
   *
   * 🔴 THIS IS THE FIELD WHOSE ABSENCE WAS THE WORST HALF OF THE PHASE-1 GAP.
   * Every other field here is optional-and-COALESCE'd so a caller sending only
   * a blob keeps the rest. `secret_kinds` cannot follow that pattern: the blob
   * has CHANGED, so keeping the previous declaration means describing the new
   * ciphertext with the old one. An owner who edits a TOTP seed away would
   * leave `secret_kinds` claiming `totp` over a blob that no longer holds it,
   * and the item would read `usable` on a factor it cannot meet. So a re-encrypt
   * MUST refresh the declaration, which is why this is required and assigned
   * rather than COALESCE'd, and why the value is derived at the choke point.
   */
  secret_kinds: string;
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

  // backup_note — optional, bounded. Whitespace-only is stored as NULL rather
  // than as a note: `hasNote()` already treats " " as absent, so persisting it
  // would clear the gap on screen while the advice layer still counts it.
  if (b.backup_note != null) {
    if (typeof b.backup_note !== 'string' || b.backup_note.length > BACKUP_NOTE_MAX) {
      throw new ValidationError(`backup_note must be ≤ ${BACKUP_NOTE_MAX} characters`, 'backup_note');
    }
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
    backup_note: normaliseNote(b.backup_note),
    // 🔴 REQUIRED, not optional — this is the fail-closed half of the wall.
    secret_kinds: requireSecretKinds(b.secret_kinds),
  };
}

/**
 * The boundary that makes a forgotten declaration IMPOSSIBLE rather than
 * merely discouraged.
 *
 * 🔴 WHY THIS REFUSES ABSENCE. `secret_kinds` describes the ciphertext, and
 * every legitimate write derives it at the one place ciphertext is made —
 * `CryptoService.encryptForUpload`, which always emits a string (empty when
 * there is nothing to declare, never absent). So a write that reaches this
 * function WITHOUT the field did not pass through that boundary: it is a
 * hand-rolled fetch, an old client, or a future path that forgot. Phase 1
 * shipped exactly that gap on three of five write paths, and the update path's
 * version was not merely honest-but-empty — it left a STALE declaration
 * standing over a re-encrypted blob, so an item read `usable` on a factor it
 * no longer held. Accepting a null here would let that back in silently. Both
 * halves of the wall are needed: derive-at-the-choke-point so the value is
 * always right, and refuse-at-the-boundary so a path that skips the choke
 * point fails loudly instead of writing null.
 *
 * ⚠️ NOT the same policy as an UNKNOWN KIND. A kind this build has not heard of
 * is DROPPED, not rejected, because the browser may be a newer build than the
 * server and breaking every save to fix a label would be its own outage
 * (`parseKindList`'s rule). Absence is different in kind: it means the write
 * never declared at all, which no current client does and no future one should.
 *
 * The three-state distinction the column keeps — null (never declared) vs ''
 * (declared as holding nothing) vs a value — still lives at the DATA layer:
 * historical rows written before 035 are null and read as `unknown`. This
 * function governs only NEW writes, where null is not a state anyone should be
 * able to create.
 */
function requireSecretKinds(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError(
      'secret_kinds is required on every write. It is derived in the browser from the ' +
        'plaintext being encrypted; a write without it did not pass through the crypto ' +
        'boundary (CryptoService.encryptForUpload) and would leave the item unusable-check ' +
        'blind. Route the write through it rather than posting a raw payload.',
      'secret_kinds',
    );
  }
  // Parsed, so unknown kinds drop and the stored form is sorted-comma-joined —
  // one value, one spelling. An empty declaration ('') survives as '', which is
  // "holds nothing recognised", a real answer distinct from never-declared.
  return (parseKindList(value) ?? []).join(',');
}

/**
 * Whitespace-only is not a note. `hasNote()` in the advice layer trims before
 * deciding, so storing "   " would clear nothing while looking like it had —
 * the owner would type a space, watch the field accept it, and still be told
 * the item has no note. Normalising at the boundary keeps one definition of
 * "has a note" instead of two that disagree.
 */
function normaliseNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Validates an update payload (re-encrypted blob, optionally renamed). */
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

  // Same rule as create. A title that is valid on the way in and rejected on the
  // way back out would be its own defect.
  if (b.title != null && (!isNonEmptyString(b.title) || (b.title as string).length > TITLE_MAX)) {
    throw new ValidationError(`title must be 1–${TITLE_MAX} characters`, 'title');
  }
  // Mirrors the create rule exactly, rather than inventing a second one: a value
  // accepted on the way in and refused on the way back out would be its own bug.
  if (b.url != null && (typeof b.url !== 'string' || b.url.length > URL_MAX)) {
    throw new ValidationError(`url must be ≤ ${URL_MAX} characters`, 'url');
  }
  // Mirrors create, for the reason stated there and above.
  if (
    b.backup_note != null &&
    (typeof b.backup_note !== 'string' || b.backup_note.length > BACKUP_NOTE_MAX)
  ) {
    throw new ValidationError(`backup_note must be ≤ ${BACKUP_NOTE_MAX} characters`, 'backup_note');
  }

  return {
    ciphertext: b.ciphertext as string,
    wrapped_data_key: b.wrapped_data_key as string,
    kms_key_id: isNonEmptyString(b.kms_key_id) ? (b.kms_key_id as string) : undefined,
    title: isNonEmptyString(b.title) ? (b.title as string) : undefined,
    service_name: typeof b.service_name === 'string' ? b.service_name : undefined,
    url: typeof b.url === 'string' ? b.url : undefined,
    backup_note: normaliseNote(b.backup_note) ?? undefined,
    // Required and refreshed on every update — the re-encrypted blob has a new
    // truth to tell. Same boundary function as create, so one rule governs both.
    secret_kinds: requireSecretKinds(b.secret_kinds),
  };
}

// ---------------------------------------------------------------------------
// SQL projections + row mapping
// ---------------------------------------------------------------------------

/**
 * The metadata projection, named once and shared by every query that feeds
 * `toMetadata`. Exported so a test fixture can be held to it: a stub row that
 * drifts from this list is a stub pretending the projection is narrower than it
 * is, which is how a mapper gets tested against a shape the product never sees.
 */
export const METADATA_COLUMNS =
  'id, type, title, service_name, url, category, criticality, ' +
  'is_root_credential, owner_set_root, recurring_billing, irreplaceable, owner_set_irreplaceable, importance_score, ' +
  'depends_on_item_id, backup_note, secret_kinds, factors_required, created_at, updated_at';

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
    /*
      The owner's own overrides, where `null` means "has not said" and drives a
      badge — so an absent column would render as an answer the owner never
      gave. `selected` refuses that read rather than guessing; see its header.
    */
    owner_set_irreplaceable: boolOrNull(selected(row, 'owner_set_irreplaceable')),
    owner_set_root: boolOrNull(selected(row, 'owner_set_root')),
    recurring_billing: Boolean(row.recurring_billing),
    irreplaceable: Boolean(row.irreplaceable),
    importance_score: Number(row.importance_score),
    depends_on_item_id: selected<string>(row, 'depends_on_item_id'),
    backup_note: (row.backup_note as string | null) ?? null,
    /*
      🔴 THIS COMMENT USED TO ARGUE THE OPPOSITE, and the argument was wrong in
      a way that cost a day. It read: "`?? null` COLLAPSES undefined INTO null,
      and that is correct HERE ... a column missing from a projection and a
      column that is SQL NULL both mean 'this read cannot tell you'."
      They do not mean the same thing one layer later. `null` here becomes
      `unknown` in usability.ts, which becomes "nobody has checked" on screen —
      a statement about the OWNER. A missing column is a statement about the
      QUERY. On 2026-08-18 the second was rendered as the first for a day, with
      2,696 tests green. `selected` keeps them apart at the moment they diverge;
      `''` versus `null` still survives untouched, which is the other
      distinction usability.ts turns on.
    */
    secret_kinds: selected<string>(row, 'secret_kinds'),
    factors_required: selected<string>(row, 'factors_required'),
    created_at: stringifyTs(row.created_at),
    updated_at: stringifyTs(row.updated_at),
  };
}

/** `null` stays null; anything else is the owner's yes or no. */
function boolOrNull(v: unknown): boolean | null {
  return v === null ? null : Boolean(v);
}

function stringifyTs(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** BYTEA → base64. pg returns BYTEA as a Buffer. */
// byteaToBase64 moved to lib/db/bytea.ts — one definition, three callers.

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Lists an owner's items (metadata only), most-important first. */
export async function listItems(ownerId: string): Promise<VaultItemMetadata[]> {
  /*
    THE OWNER REWROTE THE SECRET, SO THE HELPER WHO ENTERED IT LOSES IT — the
    created_by_delegate_id = NULL below, added 2026-08-21. It closes a false
    promise rather than adding a feature.

    created_by_delegate_id records who first entered an item, and
    POST /api/kms/unwrap reads it to let a delegate re-open something they typed
    (reasonable: they already know it). This statement rewrote the ciphertext and
    left that column alone, so after an owner CHANGED the password on an account
    their helper had set up, the helper could still unwrap it and read the new
    secret. The consent panel a parent agrees to says the opposite in so many
    words: "Anything you enter yourself stays closed to them."

    Cleared unconditionally, and ASSIGNED rather than COALESCEd, for the same
    reason secret_kinds is: the blob just changed, so everything describing the
    blob changes with it. Safe unconditionally because this statement is
    owner-scoped (owner_id is in the WHERE clause) and no delegate holds an
    items:update scope — so every call to it IS the owner.

    Rotating a credential is very often exactly BECAUSE someone should no longer
    have it, which is why the code was changed to match the copy rather than the
    copy narrowed to match the code. Pinned by
    lib/vault/owner-edit-closes-the-helper-out.test.ts.

    ⚠️ This note lives OUT here because the SQL is a template literal and the
    backticks this explanation needs would terminate it — which is exactly what
    happened on the first attempt.
  */
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
          backup_note, secret_kinds, ciphertext, wrapped_data_key, kms_key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${METADATA_COLUMNS}`,
      [
        ownerId,
        input.type,
        input.title,
        input.service_name,
        input.url,
        input.category,
        input.criticality,
        input.backup_note,
        input.secret_kinds,
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
      // COALESCE throughout: an omitted field keeps what is there, so a caller
      // that sends only a blob behaves exactly as it did before renaming existed.
      // secret_kinds is ASSIGNED, not COALESCE'd, and that difference is the fix:
      // the blob just changed, so its declaration must change with it. Every
      // other field here is COALESCE'd because omitting it means "leave it"; a
      // re-encrypt can never mean "leave the old declaration", because the thing
      // it described no longer exists.
      `UPDATE vault_items
          SET ciphertext = $1,
              wrapped_data_key = $2,
              kms_key_id = COALESCE($3, kms_key_id),
              title = COALESCE($4, title),
              service_name = COALESCE($5, service_name),
              url = COALESCE($6, url),
              backup_note = COALESCE($7, backup_note),
              secret_kinds = $8,
              -- Cleared, not COALESCEd. See the note above this query.
              created_by_delegate_id = NULL,
              updated_at = now()
        WHERE id = $9 AND owner_id = $10
       RETURNING ${METADATA_COLUMNS}`,
      [
        Buffer.from(input.ciphertext, 'base64'),
        Buffer.from(input.wrapped_data_key, 'base64'),
        input.kms_key_id ?? null,
        input.title ?? null,
        input.service_name ?? null,
        input.url ?? null,
        input.backup_note ?? null,
        input.secret_kinds,
        id,
        ownerId,
      ],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toMetadata(result.rows[0]);
}

/**
 * Records the OWNER's own answer to "do other accounts reset through this one?"
 * (Requirement 11.8).
 *
 * 🔴 THE SPEC PROMISED THIS AND NOTHING IMPLEMENTED IT. "Owner overrides SHALL
 * persist and SHALL NOT be overwritten on subsequent re-analyses of the same
 * item" — but there was no column, no endpoint and no control, so the intake
 * agent re-decided `is_root_credential` from the title on every run and the
 * owner had no way to disagree.
 *
 * It writes BOTH columns deliberately: `owner_set_root` is the record of what
 * they said, and `is_root_credential` is what the rest of the product reads.
 * Writing only the first would leave the override true and inert until the next
 * agent run; writing only the second would let the next run undo it. The two
 * together mean the change takes effect now AND survives.
 *
 * `null` clears the override and hands the decision back to the agent, which is
 * why the parameter is nullable rather than a pair of set/unset calls.
 *
 * No re-encryption: this is metadata, and requiring a ciphertext round trip to
 * tick a box would mean the browser had to hold the plaintext to change it.
 */
export async function setOwnerRootOverride(
  ownerId: string,
  id: string,
  value: boolean | null,
): Promise<VaultItemMetadata | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE vault_items
          SET owner_set_root = $1,
              is_root_credential = COALESCE($1, is_root_credential),
              updated_at = now()
        WHERE id = $2 AND owner_id = $3
       RETURNING ${METADATA_COLUMNS}`,
      [value, id, ownerId],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toMetadata(result.rows[0]);
}

/**
 * Records the OWNER's own answer to "could this be replaced?" — migration 034.
 *
 * 🔴 THE OWNER COULD OVERRULE THE AGENT ABOUT ROOT CREDENTIALS AND NOT ABOUT
 * THIS, which is the higher-consequence of the two. `irreplaceable` is what
 * `detectGaps` reads to raise a CUSTODY_RISK — the gap type covering the things
 * that cannot be regenerated from a login: a deed, a will, a passport. Only the
 * intake agent ever set it, from the title alone. If it judged a passport
 * replaceable, the custody risk was never raised and nothing on any screen
 * hinted that a judgement had been made at all.
 *
 * Writes BOTH columns for exactly the reason `setOwnerRootOverride` does:
 * `owner_set_irreplaceable` is the record of what they said, `irreplaceable` is
 * what the rest of the product reads. Only the first, and the override is inert
 * until the next agent run; only the second, and the next run undoes it.
 *
 * `null` clears the override and hands the decision back to the agent.
 */
export async function setOwnerIrreplaceableOverride(
  ownerId: string,
  id: string,
  value: boolean | null,
): Promise<VaultItemMetadata | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE vault_items
          SET owner_set_irreplaceable = $1,
              irreplaceable = COALESCE($1, irreplaceable),
              updated_at = now()
        WHERE id = $2 AND owner_id = $3
       RETURNING ${METADATA_COLUMNS}`,
      [value, id, ownerId],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toMetadata(result.rows[0]);
}

/**
 * Records what the ACCOUNT demands at the door — the owner's answer to a
 * question the server cannot infer (migration 035).
 *
 * 🔴 THE FALSEHOOD THIS EXISTS TO END. `assessPreparedness` defined *reachable*
 * as "an access rule exists", so an owner who stored the password for a
 * 2FA-protected account was told their recipient could reach it. They receive a
 * password and a locked door, and the sentence that told them otherwise is the
 * one number the product asks them to act on.
 *
 * ⚠️ THREE STATES, AND `null` IS NOT `''`. `null` = nobody has asked, which
 * reads as `unknown` and changes nothing on screen. `''` = the owner said this
 * account demands nothing beyond the secret, which is a real answer and makes
 * the item `usable`. Collapsing them would either keep the lie (null read as
 * "demands nothing") or alarm every owner about every item on the same
 * afternoon (null read as "demands something") — Q1/Q3 of the design, and the
 * second one destroys the signal permanently rather than temporarily.
 *
 * ASSIGNS RATHER THAN COALESCES, like `setItemNote` and for the same reason:
 * the value is always meant, so an owner can take an answer back.
 */
export async function setFactorsRequired(
  ownerId: string,
  id: string,
  factors: readonly string[] | null,
): Promise<VaultItemMetadata | null> {
  const value = factors === null ? null : serialiseFactorList(factors);
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE vault_items
          SET factors_required = $1,
              updated_at = now()
        WHERE id = $2 AND owner_id = $3
       RETURNING ${METADATA_COLUMNS}`,
      [value, id, ownerId],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toMetadata(result.rows[0]);
}

/**
 * Sets the recipient-facing note on an EXISTING item, without the secret.
 *
 * 🔴 WITHOUT THIS, THE NOTE WAS ONLY EVER AVAILABLE TO NEW ITEMS. It was added
 * to the create form on 2026-08-17, but the only other write path is
 * `updateItem`, which requires a re-encrypted `ciphertext` — the edit form says
 * so plainly: "Relay cannot show you the old one, it cannot read it." So adding
 * a note to something already in the vault meant retyping the password, and
 * every item an owner already had stayed permanently gapped. The fix would have
 * helped nobody who had already built a vault, which is everybody.
 *
 * Metadata-only, exactly like `setOwnerRootOverride` above: same table, same
 * owner scoping, no crypto involved, because the note is not secret.
 *
 * ⚠️ ASSIGNS RATHER THAN COALESCES, AND THAT IS THE POINT. `updateItem` uses
 * COALESCE throughout so a caller sending only a blob changes nothing else —
 * correct there, but it makes a note impossible to remove. Here the value is
 * always meant, so `null` genuinely clears it. An owner who wrote a note about
 * where something is kept and then moved it needs to be able to take that
 * sentence back.
 */
export async function setItemNote(
  ownerId: string,
  id: string,
  note: string | null,
): Promise<VaultItemMetadata | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE vault_items
          SET backup_note = $1,
              updated_at = now()
        WHERE id = $2 AND owner_id = $3
       RETURNING ${METADATA_COLUMNS}`,
      [note, id, ownerId],
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
  await cascadeDelete('access_rules', id, 'vault_item_id', ownerId);
  await withOccRetry(() =>
    query(`DELETE FROM vault_items WHERE id = $1 AND owner_id = $2`, [id, ownerId]),
  );
}
