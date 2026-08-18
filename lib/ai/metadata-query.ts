/**
 * Zero-knowledge metadata query layer (Requirement 11.5, 12.5, 13.5).
 *
 * `getVaultMetadata` is the ONLY data accessor permitted inside AI route
 * handlers. It SELECTs non-secret columns only and never returns `ciphertext`,
 * `wrapped_data_key`, or `kms_key_id` — enforcing the ZK boundary at the query
 * layer so secrets can never reach an LLM prompt.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.5, 12.5, 13.5
 */

import { query } from '../db/connection';

export interface VaultMetadata {
  id: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  type: string;
  criticality: string | null;
  is_root_credential: boolean;
  /** NULL when the owner has never said; their explicit answer otherwise (Req 11.8). */
  owner_set_root?: boolean | null;
  /**
   * The owner's own answer on replaceability (migration 034).
   *
   * ⚠️ NON-SECRET, like every other field here — but it must reach `runIntake`,
   * because that is what stops the next analysis overwriting the owner. A field
   * added to the interface and not to the SELECT would read `undefined`, and
   * `== null` would then treat every override as "never ruled on": the column
   * would exist, the control would appear to work, and the correction would
   * vanish on the next run. Silently.
   */
  owner_set_irreplaceable?: boolean | null;
  recurring_billing: boolean;
  irreplaceable: boolean;
  importance_score: number;
  depends_on_item_id: string | null;
  backup_note: string | null;
}

// Non-secret columns ONLY — ciphertext / wrapped_data_key / kms_key_id excluded.
const METADATA_COLUMNS =
  'id, title, service_name, url, category, type, criticality, ' +
  'is_root_credential, owner_set_root, recurring_billing, irreplaceable, owner_set_irreplaceable, importance_score, ' +
  'depends_on_item_id, backup_note';

export async function getVaultMetadata(ownerId: string): Promise<VaultMetadata[]> {
  const r = await query<Record<string, unknown>>(
    `SELECT ${METADATA_COLUMNS} FROM vault_items WHERE owner_id = $1`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    service_name: (row.service_name as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    type: String(row.type),
    criticality: (row.criticality as string | null) ?? null,
    is_root_credential: Boolean(row.is_root_credential),
    owner_set_root: row.owner_set_root === null || row.owner_set_root === undefined ? null : Boolean(row.owner_set_root),
    owner_set_irreplaceable:
      row.owner_set_irreplaceable === null || row.owner_set_irreplaceable === undefined
        ? null
        : Boolean(row.owner_set_irreplaceable),
    recurring_billing: Boolean(row.recurring_billing),
    irreplaceable: Boolean(row.irreplaceable),
    importance_score: Number(row.importance_score),
    depends_on_item_id: (row.depends_on_item_id as string | null) ?? null,
    backup_note: (row.backup_note as string | null) ?? null,
  }));
}
