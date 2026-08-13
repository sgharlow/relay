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

const MAX_BATCH = 1000;

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
  const existing = await query<{ title: string; service_name: string | null }>(
    `SELECT title, service_name FROM vault_items WHERE owner_id = $1`,
    [auth.ownerId],
  );
  const { fresh, duplicates } = splitDuplicates(validated, existing.rows);

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
  for (const input of fresh) {
    await createItem(auth.ownerId, input);
    imported++;
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
    detail: { count: imported, duplicatesSkipped: duplicates.length },
  });

  // Report the skips. A silent skip is its own defect: the owner counted the
  // rows in their export and will conclude the import lost credentials.
  return NextResponse.json({ imported, duplicatesSkipped: duplicates.length });
}
