/**
 * Intake Agent (Requirement 11) — classifies + scores vault items from
 * non-secret metadata and writes the flags/score back.
 *
 * Reads ONLY via getVaultMetadata (ZK boundary, Req 11.5), classifies through
 * the OpenAI seam, clamps every importance_score into [0,1] (Property 18,
 * Req 11.7), resolves `depends_on_title` → `depends_on_item_id` within the batch
 * (Req 11.6), and persists each item via withOccRetry. On classification failure
 * or timeout it defaults score 0.5 / is_root_credential false, lists the items in
 * `warnings`, and never blocks (Req 11.9). Batches are capped at 300 (Req 11.10)
 * and whatever the cap left behind is reported as `remaining` rather than
 * dropped in silence — see that field.
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
  /**
   * Items in the vault this run did NOT reach, because the batch cap
   * (Req 11.10) is smaller than the vault.
   *
   * 🔴 THIS RUN USED TO BE SILENT ABOUT THEM. The metadata was sliced to
   * `batchLimit` and the result said `scored: 300` — true, and it reads as
   * "your vault is scored". `entitlements.paid.items` is Infinity, so a vault
   * CAN exceed the cap, and J2's own success criterion is a 300-item real
   * vault: the first account large enough to matter is the first account the
   * old number misreported.
   *
   * Non-zero here does NOT mean the rest get scored on the next run. There is
   * no "never scored" marker to order by — `importance_score` is NOT NULL
   * DEFAULT 0.5, so an unscored item is indistinguishable from one scored at
   * exactly 0.5 — and adding one is a migration, which is a sysadmin act that
   * lands separately from this code. What is fixed here is the claim; batching
   * across runs needs that column first.
   *
   * ⚠️ OPTIONAL IN THE TYPE, ALWAYS SET BY `runIntake`. Fixtures outside this
   * module build an `IntakeResult` by hand, and making it required would fail
   * their compile rather than their behaviour — a type error in a mock is not
   * the signal this field exists to send. Tighten to required once those
   * fixtures carry it.
   */
  remaining?: number;
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

  const all = await getVaultMetadata(ownerId);
  const items = all.slice(0, batchLimit);
  const remaining = all.length - items.length;
  if (items.length === 0) return { scored: 0, remaining, warnings: [], results: [] };

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
      /*
        🔴 THIS USED TO RESET is_root_credential TO false, AND ONE LLM TIMEOUT
        WIPED IT ACROSS THE WHOLE VAULT. `allFailed` defaults EVERY item, and
        the row was then written — so a single timeout silently downgraded every
        root credential the owner had, with nothing but a per-item warning to
        show for it.

        That flag is not cosmetic. bucketFor forces root credentials into "Do
        today" regardless of score, and the handoff order puts them first, so
        losing it silently reorders what a grieving person is told to do first
        — and the reordering looks completely normal.

        Req 11.9 requires exactly one thing on failure: assign a default
        importance_score of 0.5, warn, and do not block. It says nothing about
        the flags, and Req 11.8 says the opposite — that a classification the
        owner set "SHALL NOT be overwritten on subsequent re-analyses". The
        other three fields were already preserved here; root was the outlier.

        Preserving it is also correct for a NEW item: the column is NOT NULL
        DEFAULT false, so an unclassified item keeps false either way.
      */
      result = {
        id: item.id,
        importance_score: DEFAULT_SCORE,
        is_root_credential: item.is_root_credential,
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
        /*
          🔴 REQ 11.8: "Owner overrides SHALL persist and SHALL NOT be
          overwritten on subsequent re-analyses of the same item." Until now
          there was no way to override anything, so every run re-decided this
          from the title — and an owner who knew that three other accounts reset
          through their email had no way to say so.

          `owner_set_root` is NULL for every item nobody has ruled on, which is
          every item that existed before this, so the model still decides those.
          Once the owner has answered, their answer wins and keeps winning.
        */
        is_root_credential:
          // `== null` on purpose: an absent field and an explicit NULL both mean
          // "the owner has never ruled on this", and callers built from partial
          // fixtures omit it entirely.
          item.owner_set_root == null ? Boolean(c.is_root_credential) : item.owner_set_root,
        recurring_billing: Boolean(c.recurring_billing),
        /*
          The same rule, for the higher-consequence flag. `irreplaceable` is what
          raises a CUSTODY_RISK — a deed, a will, a passport — and until
          migration 034 the model decided it alone, on every run, from the title.
          An owner correcting it would have watched the correction disappear at
          the next analysis, which is why the override needed its own column
          rather than a direct write.
        */
        irreplaceable:
          item.owner_set_irreplaceable == null
            ? Boolean(c.irreplaceable)
            : item.owner_set_irreplaceable,
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

  return { scored: results.length, remaining, warnings, results };
}
