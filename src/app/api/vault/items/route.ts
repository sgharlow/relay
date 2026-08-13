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
import { listItemsIEntered } from '../../../../../lib/people/delegate-workspace';
import { IntegrityError } from '../../../../../lib/db/integrity';
import { recordDeliberateActivity } from '../../../../../lib/release/liveness';
import { readJson, isResponse, VAULT_MAX_JSON_BYTES } from '../../../../../lib/http/owner-route';

export async function GET(req: NextRequest): Promise<NextResponse> {
  /**
   * 🔴 A HELPER COULD ADD AN ITEM AND NEVER SEE IT AGAIN. POST has accepted
   * `?ownerId=` since delegation shipped; GET never did, so somebody tidying a
   * parent's vault watched each entry vanish on save. Added 2026-08-12.
   *
   * The two paths return DIFFERENT QUESTIONS rather than one filtered view: an
   * owner gets their vault, a helper gets the things they personally entered
   * (J3-R4). Keeping them as separate calls means there is no shared argument
   * that could be got wrong in a way that widens the narrow one.
   */
  let targetOwnerId: string | null = null;
  try {
    targetOwnerId = new URL(req.url).searchParams.get('ownerId');
  } catch {
    targetOwnerId = null;
  }

  const actor = await resolveActor(targetOwnerId);
  if (actor instanceof NextResponse) return actor;

  if (actor.isDelegate) {
    return NextResponse.json({
      items: await listItemsIEntered(actor.ownerId, actor.delegationId as string),
      scopedToDelegate: true,
    });
  }

  const items = await listItems(actor.ownerId);
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

  /*
    Adding to your own vault is a check-in ([A4]) — and it recorded nothing until
    2026-08-13, while the manual said "any deliberate action in the product
    counts". An owner who filled their vault every week and never opened the
    People screen would still be swept into a PENDING release and have their
    verifiers emailed to ask whether they were dead.

    §3.7 RULE 8 IS THE REASON THIS IS NOT JUST `requireOwner(req)`. A HELPER
    tidying somebody's vault must not mark that somebody as alive: the scenario
    the dead-man's-switch exists for is the owner in hospital while a relative
    keeps things running, and counting the relative's typing would suppress it at
    exactly the moment it should fire. `actingForOwnerId` makes that structural
    rather than remembered — the write is discarded when the two differ.
  */
  await recordDeliberateActivity({
    userId: actor.actingUserId,
    method: req.method,
    actingForOwnerId: ownerId,
  });

  try {
    requireScope(actor, 'items:create');
  } catch (err) {
    if (err instanceof IntegrityError) {
      return NextResponse.json({ error: 'Forbidden', message: err.message }, { status: 403 });
    }
    throw err;
  }

  const body = await readJson(req, VAULT_MAX_JSON_BYTES);
  if (isResponse(body)) return body;

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
