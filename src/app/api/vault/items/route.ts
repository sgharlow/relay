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
import { query } from '../../../../../lib/db/connection';
import { assertWithinItemCap, EntitlementError } from '../../../../../lib/billing/entitlements';
import { coverNewItem } from '../../../../../lib/rules/policy-materialize';
import { resolveActor, requireScope } from '../../../../../lib/http/delegate-route';
import { IntegrityError } from '../../../../../lib/db/integrity';

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
  // A delegate acting on another person's vault passes ?ownerId=; resolveActor
  // refuses unless an active delegation covers that exact pair (J3-R11).
  let targetOwnerId: string | null = null;
  try {
    targetOwnerId = new URL(req.url).searchParams.get('ownerId');
  } catch {
    targetOwnerId = null;
  }

  const actor = await resolveActor(targetOwnerId);
  if (actor instanceof NextResponse) return actor;

  const ownerId = actor.ownerId;

  try {
    requireScope(actor, 'items:create');
  } catch (err) {
    if (err instanceof IntegrityError) {
      return NextResponse.json({ error: 'Forbidden', message: err.message }, { status: 403 });
    }
    throw err;
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

  // Free-tier cap, asserted server-side so it cannot be bypassed by calling
  // this endpoint directly (J1-R7).
  try {
    await assertWithinItemCap(ownerId);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        { error: 'EntitlementError', message: err.message, limit: err.limit, tier: err.tier },
        { status: 402 },
      );
    }
    throw err;
  }

  const item = await createItem(ownerId, input);

  // Provenance: which delegate entered this, so the read boundary can be
  // enforced later. NULL means the owner entered it themselves (J3-R4).
  if (actor.isDelegate) {
    await query(
      `UPDATE vault_items SET created_by_delegate_id = $2 WHERE id = $1 AND owner_id = $3`,
      [item.id, actor.delegationId, ownerId],
    );
  }

  await writeAuditEntry(ownerId, {
    actor: actor.isDelegate ? `delegate:${actor.delegationId}` : `owner:${ownerId}`,
    action: 'vault_item_created',
    entity: 'vault_item',
    entityId: item.id,
    detail: { type: item.type },
  });

  // A new item matching an existing policy is covered automatically, so an
  // import cannot land silently uncovered (J4-R4).
  const covered = await coverNewItem(ownerId, item.id);

  return NextResponse.json({ ...item, policiesMatched: covered.policiesMatched }, { status: 201 });
}
