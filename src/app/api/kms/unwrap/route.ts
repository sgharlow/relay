/**
 * POST /api/kms/unwrap — KMS proxy: unwrap a stored data key (auth-gated).
 *
 * Body: { wrapped_data_key, vault_item_id, recipient_token? }
 *
 * Two caller types:
 *  - Owner   — must own the vault item (assertOwns); always permitted.
 *  - Recipient — permitted IFF the release_state named in their scoped token is
 *    RELEASED *and* an access_rules row links (recipient_id, vault_item_id).
 *
 * The KMS Decrypt call is made ONLY after the gate passes (Property 6). Any gate
 * failure returns 403 and performs NO KMS call. The unwrapped plaintext data key
 * is returned to the browser over TLS for the final AES-GCM decrypt.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.4, 7.5, 17.4
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyRecipientToken } from '../../../../../lib/auth/recipient-token';
import { assertOwns } from '../../../../../lib/db/integrity';
import { decryptDataKey } from '../../../../../lib/kms/kms-client';
import { evaluateRecipientUnwrap } from '../../../../../lib/kms/unwrap-gate';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { query } from '../../../../../lib/db/connection';
import { resolveActor, assertDelegateMayRead } from '../../../../../lib/http/delegate-route';
import { IntegrityError } from '../../../../../lib/db/integrity';

/** Defensive: a handler must not throw on an absent or malformed request URL. */
function ownerIdParam(req: NextRequest): string | null {
  try {
    return new URL(req.url).searchParams.get('ownerId');
  } catch {
    return null;
  }
}

interface UnwrapBody {
  wrapped_data_key?: string;
  vault_item_id?: string;
  recipient_token?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: UnwrapBody;
  try {
    body = (await req.json()) as UnwrapBody;
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid JSON body' }, { status: 400 });
  }

  const { wrapped_data_key, vault_item_id } = body;
  if (!wrapped_data_key || !vault_item_id) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'wrapped_data_key and vault_item_id are required' },
      { status: 400 },
    );
  }

  // ---- Recipient path (scoped token in Authorization header or body) ----
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : body.recipient_token;

  if (token) {
    let payload;
    try {
      payload = verifyRecipientToken(token);
    } catch {
      return NextResponse.json({ error: 'Forbidden', message: 'Invalid recipient token' }, { status: 403 });
    }

    const { allowed, ownerId } = await evaluateRecipientUnwrap({
      recipientId: payload.recipientId,
      vaultItemId: vault_item_id,
      releaseStateId: payload.releaseStateId,
    });

    if (!allowed) {
      if (ownerId) {
        await writeAuditEntry(ownerId, {
          actor: `recipient:${payload.recipientId}`,
          action: 'kms_unwrap_denied',
          entity: 'vault_item',
          entityId: vault_item_id,
          detail: { outcome: 'denied' },
        });
      }
      return NextResponse.json({ error: 'Forbidden', message: 'Access not permitted' }, { status: 403 });
    }

    const plaintextDataKey = await decryptDataKey(wrapped_data_key);
    if (ownerId) {
      await writeAuditEntry(ownerId, {
        actor: `recipient:${payload.recipientId}`,
        action: 'kms_unwrap',
        entity: 'vault_item',
        entityId: vault_item_id,
        detail: { outcome: 'authorized' },
      });
    }
    return NextResponse.json({ plaintext_data_key: plaintextDataKey });
  }

  // ---- Owner / delegate path ----
  // A delegate acting on someone else's vault passes ?ownerId=. They may unwrap
  // ONLY items they personally entered (J3-R4) — this is the point at which a
  // helper could otherwise read a parent's whole vault.
  const targetOwnerId = ownerIdParam(req);
  const actor = await resolveActor(targetOwnerId);
  if (actor instanceof NextResponse) return actor;

  const ownerId = actor.ownerId;

  try {
    await assertOwns(ownerId, 'vault_items', vault_item_id);
  } catch {
    return NextResponse.json({ error: 'Forbidden', message: 'Not the item owner' }, { status: 403 });
  }

  if (actor.isDelegate) {
    const prov = await query<{ created_by_delegate_id: string | null }>(
      `SELECT created_by_delegate_id FROM vault_items WHERE id = $1 AND owner_id = $2 LIMIT 1`,
      [vault_item_id, ownerId],
    );

    try {
      assertDelegateMayRead(actor, prov.rows[0] ?? {});
    } catch (err) {
      if (err instanceof IntegrityError) {
        await writeAuditEntry(ownerId, {
          actor: `delegate:${actor.delegationId}`,
          action: 'kms_unwrap_denied',
          entity: 'vault_item',
          entityId: vault_item_id,
          detail: { outcome: 'denied', reason: 'not_entered_by_delegate' },
        });
        // No KMS call was made.
        return NextResponse.json(
          { error: 'Forbidden', message: 'You can only open items you entered yourself' },
          { status: 403 },
        );
      }
      throw err;
    }
  }

  const plaintextDataKey = await decryptDataKey(wrapped_data_key);
  await writeAuditEntry(ownerId, {
    actor: actor.isDelegate ? `delegate:${actor.delegationId}` : `owner:${ownerId}`,
    action: 'kms_unwrap',
    entity: 'vault_item',
    entityId: vault_item_id,
    detail: { outcome: 'authorized' },
  });
  return NextResponse.json({ plaintext_data_key: plaintextDataKey });
}
