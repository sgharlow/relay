/**
 * Intake Agent (Requirement 11) — classifies + scores vault items from
 * non-secret metadata and writes the flags/score back.
 *
 * Reads ONLY via getVaultMetadata (ZK boundary, Req 11.5), classifies through
 * the OpenAI seam, clamps every importance_score into [0,1] (Property 18,
 * Req 11.7), resolves `depends_on_title` → `depends_on_item_id` within the batch
 * (Req 11.6), and persists each item via withOccRetry. On classification failure
 * or timeout it defaults score 0.5 / is_root_credential false, lists the items in
 * `warnings`, and never blocks (Req 11.9). Batches are capped at 300 (Req 11.10).
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1–11.7, 11.9, 11.10
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { getVaultMetadata, type VaultMetadata } from './metadata-query';
import { classifyVaultItems, type RawClassification } from './openai-client';

const BATCH_LIMIT = 300;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SCORE = 0.5;

export interface IntakeItemResult {
  id: string;
  importance_score: number;
  is_root_credential: boolean;
  recurring_billing: boolean;
  irreplaceable: boolean;
  depends_on_item_id: string | null;
  defaulted: boolean;
}

export interface IntakeResult {
  scored: number;
  /** Item ids that used the default classification (LLM failure/timeout). */
  warnings: string[];
  results: IntakeItemResult[];
}

export interface IntakeOptions {
  classify?: (items: VaultMetadata[]) => Promise<RawClassification[]>;
  timeoutMs?: number;
  batchLimit?: number;
}

/** Clamps any number into [0,1]; non-finite values fall back to the default. */
export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCORE;
  return Math.min(1, Math.max(0, n));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('intake classification timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function resolveDepends(
  dependsOnTitle: string | null,
  titleToId: Map<string, string>,
  selfId: string,
): string | null {
  if (!dependsOnTitle) return null;
  const id = titleToId.get(dependsOnTitle.toLowerCase());
  return id && id !== selfId ? id : null;
}

export async function runIntake(ownerId: string, opts: IntakeOptions = {}): Promise<IntakeResult> {
  const classify = opts.classify ?? classifyVaultItems;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const batchLimit = opts.batchLimit ?? BATCH_LIMIT;

  const items = (await getVaultMetadata(ownerId)).slice(0, batchLimit);
  if (items.length === 0) return { scored: 0, warnings: [], results: [] };

  const titleToId = new Map(items.map((i) => [i.title.toLowerCase(), i.id]));

  let classifications: RawClassification[] = [];
  let allFailed = false;
  try {
    classifications = await withTimeout(classify(items), timeoutMs);
  } catch {
    allFailed = true; // Req 11.9 — default every item, do not block.
  }
  const byId = new Map(classifications.map((c) => [c.id, c]));

  const warnings: string[] = [];
  const results: IntakeItemResult[] = [];

  for (const item of items) {
    const c = allFailed ? undefined : byId.get(item.id);
    let result: IntakeItemResult;

    if (!c) {
      // Default — keep existing recurring/irreplaceable/depends, reset score+root.
      result = {
        id: item.id,
        importance_score: DEFAULT_SCORE,
        is_root_credential: false,
        recurring_billing: item.recurring_billing,
        irreplaceable: item.irreplaceable,
        depends_on_item_id: item.depends_on_item_id,
        defaulted: true,
      };
      warnings.push(item.id);
    } else {
      result = {
        id: item.id,
        importance_score: clampScore(c.importance_score),
        is_root_credential: Boolean(c.is_root_credential),
        recurring_billing: Boolean(c.recurring_billing),
        irreplaceable: Boolean(c.irreplaceable),
        depends_on_item_id: resolveDepends(c.depends_on_title, titleToId, item.id),
        defaulted: false,
      };
    }

    await withOccRetry(() =>
      query(
        `UPDATE vault_items
            SET is_root_credential = $1, recurring_billing = $2, irreplaceable = $3,
                importance_score = $4, depends_on_item_id = $5
          WHERE id = $6 AND owner_id = $7`,
        [
          result.is_root_credential,
          result.recurring_billing,
          result.irreplaceable,
          result.importance_score,
          result.depends_on_item_id,
          item.id,
          ownerId,
        ],
      ),
    );
    results.push(result);
  }

  return { scored: results.length, warnings, results };
}
