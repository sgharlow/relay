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
  updateItem,
  deleteItem,
  validateUpdateInput,
  ValidationError,
} from '../../../../../../lib/vault/vault-items';
import { writeAuditEntry } from '../../../../../../lib/audit/audit-service';
import { recordDeliberateActivity } from '../../../../../../lib/release/liveness';
import { readJson, isResponse, VAULT_MAX_JSON_BYTES } from '../../../../../../lib/http/owner-route';

const FORBIDDEN = { error: 'Forbidden', message: 'Not authorized for this item' };

type Ctx = { params: Promise<{ id: string }> };

/**
 * Resolve owner session + assert ownership. Returns ownerId or a response to send.
 *
 * `method` records passive liveness ([A4]) on the write verbs. Editing a rotated
 * password or deleting a closed account is a person, present, keeping their plan
 * current — and it counted for nothing until 2026-08-13. Reads are excluded by
 * `recordDeliberateActivity` itself: a phone left logged in in a hospital drawer
 * polls for days, and letting that suppress the switch is the failure mode.
 */
async function authorize(
  id: string,
  method?: string,
): Promise<{ ownerId: string } | NextResponse> {
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }
  if (method) await recordDeliberateActivity({ userId: ownerId, method });
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

/*
  GET was here and is gone — RETIRED 2026-08-13. It fetched ONE item, and there
  was nothing it returned that anything wanted: the list endpoint already carries
  the metadata every screen needs, and the ciphertext is never served back to an
  owner — they re-encrypt on update rather than reading the old value, because
  Relay cannot decrypt it. PUT and DELETE below are both reached from /vault.
*/

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await authorize((await params).id, req.method);
  if (auth instanceof NextResponse) return auth;

  const body = await readJson(req, VAULT_MAX_JSON_BYTES);
  if (isResponse(body)) return body;

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

  const updated = await updateItem(auth.ownerId, (await params).id, input);
  if (!updated) return NextResponse.json(FORBIDDEN, { status: 403 });

  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'vault_item_updated',
    entity: 'vault_item',
    entityId: (await params).id,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await authorize((await params).id, req.method);
  if (auth instanceof NextResponse) return auth;

  await deleteItem(auth.ownerId, (await params).id);

  await writeAuditEntry(auth.ownerId, {
    actor: `owner:${auth.ownerId}`,
    action: 'vault_item_deleted',
    entity: 'vault_item',
    entityId: (await params).id,
  });

  return NextResponse.json({ deleted: true });
}
