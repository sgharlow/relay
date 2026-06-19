/**
 * /api/vault/items/[id] — single owner vault item.
 *
 *   GET    → full item incl. base64 ciphertext + wrapped key (owner edit view)
 *   PUT    → replace ciphertext + wrapped key, bump updated_at
 *   DELETE → cascade-delete access_rules, then the item
 *
 * Every handler asserts ownership first. A not-found row and a cross-owner row
 * both return the SAME 403 — existence is never revealed (Requirement 1.8).
 *
 * Feature: relay-h0-mvp
 * Requirements: 1.5–1.8
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getOwnerSession } from '../../../../../../lib/auth/session';
import { assertOwns, IntegrityError } from '../../../../../../lib/db/integrity';
import {
  getItemForOwner,
  updateItem,
  deleteItem,
  validateUpdateInput,
  ValidationError,
} from '../../../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../../../lib/audit/audit-service';

const FORBIDDEN = { error: 'Forbidden', message: 'Not authorized for this item' };

type Ctx = { params: { id: string } };

/** Resolve owner session + assert ownership. Returns ownerId or a response to send. */
async function authorize(id: string): Promise<{ ownerId: string } | NextResponse> {
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }
  try {
    await assertOwns(ownerId, 'vault_items', id);
  } catch (err) {
    // NOT_FOUND and UNAUTHORIZED both collapse to 403 (do not reveal existence).
    if (err instanceof IntegrityError) {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    throw err;
  }
  return { ownerId };
}

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await authorize(params.id);
  if (auth instanceof NextResponse) return auth;

  const item = await getItemForOwner(auth.ownerId, params.id);
  if (!item) return NextResponse.json(FORBIDDEN, { status: 403 });
  return NextResponse.json(item);
}

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await authorize(params.id);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = validateUpdateInput(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    throw err;
  }

  const updated = await updateItem(auth.ownerId, params.id, input);
  if (!updated) return NextResponse.json(FORBIDDEN, { status: 403 });

  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'vault_item_updated',
    entity: 'vault_item',
    entityId: params.id,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await authorize(params.id);
  if (auth instanceof NextResponse) return auth;

  await deleteItem(auth.ownerId, params.id);

  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'vault_item_deleted',
    entity: 'vault_item',
    entityId: params.id,
  });

  return NextResponse.json({ deleted: true });
}
