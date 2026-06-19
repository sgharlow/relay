/**
 * /api/vault/items — Owner vault item collection.
 *
 *   GET  → list the owner's items (metadata only; never ciphertext/wrapped key)
 *   POST → create an item from a client-encrypted payload + metadata
 *
 * Both require an authenticated Owner session. POST validates type/title/url/
 * category/criticality and rejects invalid input with 400 before persisting.
 *
 * Feature: relay-h0-mvp
 * Requirements: 1.1–1.4
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getOwnerSession } from '../../../../../lib/auth/session';
import {
  listItems,
  createItem,
  validateCreateInput,
  ValidationError,
} from '../../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';

export async function GET(): Promise<NextResponse> {
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }

  const items = await listItems(ownerId);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = validateCreateInput(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    throw err;
  }

  const item = await createItem(ownerId, input);

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'vault_item_created',
    entity: 'vault_item',
    entityId: item.id,
    detail: { type: item.type },
  });

  return NextResponse.json(item, { status: 201 });
}
