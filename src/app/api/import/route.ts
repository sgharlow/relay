/**
 * POST /api/import — batch upload of client-encrypted vault items (Req 10.4, 13.3).
 *
 * Body: { items: [{ ciphertext, wrapped_data_key, kms_key_id, ...metadata }] }.
 * The server NEVER decrypts. Every item's metadata is validated upfront — if any
 * item is invalid the whole batch is rejected (400) with nothing inserted; then
 * each valid item is INSERTed via createItem (withOccRetry). Returns the count
 * persisted.
 *
 * Feature: relay-h0-mvp
 * Requirements: 10.4, 10.8
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse } from '../../../../lib/http/owner-route';
import { createItem, validateCreateInput, ValidationError } from '../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { query } from '../../../../lib/db/connection';
import { splitDuplicates } from '../../../../lib/vault/dedupe';
import { runIntake } from '../../../../lib/ai/intake-agent';
import { assertBatchWithinItemCap, EntitlementError } from '../../../../lib/billing/entitlements';
import { coverNewItem } from '../../../../lib/rules/policy-materialize';

const MAX_BATCH = 1000;

/** How many skipped rows are named back to the owner. See `duplicateRows`. */
const DUPLICATE_ROWS_REPORTED = 50;

/**
 * Above this many new items, policy coverage is left to the Rules screen.
 *
 * `coverNewItem` reloads the owner's whole item list and policy set per call, so
 * covering a batch inline is quadratic. At MAX_BATCH that is two thousand round
 * trips inside one request — a timeout, which would report a successful import
 * as a failure and is worse than the gap being closed. A batch variant belongs
 * with the policy code; until it exists this is bounded and, crucially, SAID:
 * `coverageDeferred` goes back to the client rather than being swallowed.
 */
const COVERAGE_INLINE_MAX = 100;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // `req` so this counts as a check-in ([A4]). Filling a vault is the most
  // deliberate act in the product and it recorded nothing until 2026-08-13.
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  /*
    The one route that legitimately sends more than the 128 KB default: a whole
    password-manager export. MAX_BATCH is 1000 items and a measured item with a
    2 KB plaintext serialises to ~3.2 KB, so a full batch is ~3.1 MB. 8 MB leaves
    room for longer notes without leaving the door open — the batch-count check
    below is what actually caps how much work this does.
  */
  const body = await readJson(req, 8 * 1024 * 1024);
  if (isResponse(body)) return body;

  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'BadRequest', message: 'items must be an array' }, { status: 400 });
  }
  if (items.length === 0) return NextResponse.json({ imported: 0 });
  if (items.length > MAX_BATCH) {
    return NextResponse.json({ error: 'BadRequest', message: `Batch exceeds ${MAX_BATCH} items` }, { status: 400 });
  }

  // Validate the entire batch BEFORE inserting anything (Req 10.4 — all or nothing).
  const validated = [];
  for (let i = 0; i < items.length; i++) {
    try {
      validated.push(validateCreateInput(items[i]));
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: 'ValidationError', message: err.message, field: err.field, index: i },
          { status: 400 },
        );
      }
      throw err;
    }
  }

  // Skip what is already here. Re-running an export after adding two accounts
  // used to double the whole vault, which matters because the recipient's
  // access plan is RANKED — a vault full of pairs makes the ranking meaningless
  // and doubles the length of the screen someone reads during an emergency.
  //
  // ⚠️ `url` IS SELECTED AND THAT IS LOAD-BEARING (2026-08-21). Matching used
  // to be title + service_name alone, and the import client writes
  // `title: row.service_name`, so every row from an export has title ===
  // service_name: two Google logins were one key, and the second credential was
  // dropped. lib/vault/dedupe.ts now lets an address SEPARATE two rows sharing a
  // label — but only if it can see one on both sides. Drop `url` from this
  // SELECT and every stored item reads as address-less, the label decides again,
  // and the fix quietly covers the in-batch case only.
  const existing = await query<{ title: string; service_name: string | null; url: string | null }>(
    `SELECT title, service_name, url FROM vault_items WHERE owner_id = $1`,
    [auth.ownerId],
  );
  const { fresh, duplicates } = splitDuplicates(validated, existing.rows);

  /*
    WHICH rows were skipped, not just how many.

    "left 1 already in your vault untouched" tells an owner that something did
    not arrive and gives them no way to find out what. J2 step 3 asks for every
    skip reported with its row number and reason; this is the duplicate half of
    that (the parser already reports unreadable rows with theirs).

    Reference identity, not a recomputed key: `duplicates` holds the very objects
    from `validated`, so the position is exact and no second key derivation can
    drift from the first.

    🔴 `position`, NOT `row`, AND THE DIFFERENCE IS NOT PEDANTRY. This is an
    index into the uploaded BATCH, and the batch is what SURVIVED parsing:
    lib/import/csv-parser.ts drops rows for a missing service name or password
    and for in-file duplicates, reporting those with `dataRow`, which is true to
    the file. Called `row`, this number was rendered on the same screen, under
    the same word, beside those — so one unreadable line above shifted every
    number here by one and an owner comparing the two lists was sent to the
    wrong line of their own export. Nothing in this payload carries a file line;
    `ParsedRow` would have to carry `dataRow` through the client for that. Until
    it does, the field says what it is, and the two things an owner can actually
    search for — the label and the address — travel with it. `url` is what tells
    two logins at one provider apart, which is the case this report exists for.
  */
  const skipped = new Set<unknown>(duplicates);
  const duplicateRows = validated
    .map((v, i) => ({ position: i + 1, title: v.title, url: v.url ?? null, v }))
    .filter((r) => skipped.has(r.v))
    .map(({ position, title, url }) => ({ position, title, url }))
    // A 1000-row export that is entirely a re-import would otherwise answer with
    // 1000 rows nobody reads. The count above stays exact either way.
    .slice(0, DUPLICATE_ROWS_REPORTED);

  /*
    🔴 THE FREE-TIER CAP WAS NOT ENFORCED HERE AT ALL until 2026-08-13. Only
    `POST /api/vault/items` checked it, so the limit that defines the free tier
    held on the one-at-a-time path and not on the bulk one — the path the product
    recommends as the way to start. Found by reading the user manual against the
    routes it describes.

    Checked AFTER dedupe, on `fresh`, not on the uploaded batch: re-running an
    export you already imported adds nothing, so it must not be refused for
    exceeding a cap it does not actually consume.
  */
  try {
    await assertBatchWithinItemCap(auth.ownerId, fresh.length);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        { error: 'EntitlementError', message: err.message, limit: err.limit, tier: err.tier },
        { status: 402 },
      );
    }
    throw err;
  }

  let imported = 0;
  const createdIds: string[] = [];
  for (const input of fresh) {
    const created = await createItem(auth.ownerId, input);
    imported++;
    if (created?.id) createdIds.push(created.id);
  }

  /*
    🔴 J4-R4 RAN ON THE OTHER PRODUCER ONLY, and that producer's comment named
    this one. src/app/api/vault/items/route.ts calls `coverNewItem` under "so an
    import cannot land silently uncovered (J4-R4)", and lib/rules/policy-materialize.ts
    describes itself as covering an item "so an imported item is not silently
    uncovered" — while /api/import, the import, called neither. Both comments
    described a behaviour that existed on one route out of two.

    docs/user-journeys.md states the consequence plainly: "every newly imported
    item lands uncovered by default, silently". An owner accepts the policies
    Relay proposed, imports their password manager, and none of it is reachable
    by anyone they named. Nothing on the screen said so, because nothing knew.

    Best-effort and AFTER the writes, in the shape of the intake call below: the
    items are safely stored either way, and a matching failure must not turn a
    successful import into an error somebody reads as "nothing saved".
  */
  let policiesMatched = 0;
  let coverageDeferred = false;
  if (createdIds.length > 0) {
    try {
      // One cheap probe first. Most owners hold no policies at all, and covering
      // against an empty set is N round trips to learn nothing.
      const anyPolicy = await query<{ id: string }>(
        `SELECT id FROM access_policies WHERE owner_id = $1 LIMIT 1`,
        [auth.ownerId],
      );
      if (anyPolicy.rows.length > 0) {
        if (createdIds.length > COVERAGE_INLINE_MAX) {
          coverageDeferred = true;
        } else {
          for (const id of createdIds) {
            policiesMatched += (await coverNewItem(auth.ownerId, id)).policiesMatched;
          }
        }
      }
    } catch (err) {
      // Reported, not silent: the owner is told coverage did not complete, which
      // is the half of J4-R4 that says they SHALL be notified.
      coverageDeferred = true;
      process.stderr.write(`[import] policy coverage failed for ${auth.ownerId}: ${String(err)}
`);
    }
  }

  // Score what just arrived. Until 2026-08-08 only the guided seed called the
  // intake agent, so an imported vault sat at a flat importance of 0.5 with no
  // dependency graph — meaning the caregiver who gave us the MOST data got the
  // worst product: an unranked access plan and an empty risk reveal, which is
  // the thing the price is justified by.
  //
  // Best-effort and after the writes: the items are safely stored either way,
  // and a scoring failure must not turn a successful import into an error.
  if (imported > 0) {
    try {
      await runIntake(auth.ownerId);
    } catch (err) {
      process.stderr.write(`[import] intake scoring failed for ${auth.ownerId}: ${String(err)}\n`);
    }
  }

  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'vault_items_imported',
    entity: 'vault_item',
    detail: { count: imported, duplicatesSkipped: duplicates.length, policiesMatched, coverageDeferred },
  });

  // Report the skips. A silent skip is its own defect: the owner counted the
  // rows in their export and will conclude the import lost credentials.
  return NextResponse.json({
    imported,
    duplicatesSkipped: duplicates.length,
    duplicateRows,
    policiesMatched,
    coverageDeferred,
  });
}
