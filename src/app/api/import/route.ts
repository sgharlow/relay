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

  let imported = 0;
  for (const input of validated) {
    await createItem(auth.ownerId, input);
    imported++;
  }

  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'vault_items_imported',
    entity: 'vault_item',
    detail: { count: imported },
  });

  return NextResponse.json({ imported });
}
