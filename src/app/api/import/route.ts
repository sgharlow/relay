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

const MAX_BATCH = 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
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
