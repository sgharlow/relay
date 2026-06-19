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
import { getOwnerSession } from '../../../../../lib/auth/session';
import { verifyRecipientToken } from '../../../../../lib/auth/recipient-token';
import { assertOwns } from '../../../../../lib/db/integrity';
import { decryptDataKey } from '../../../../../lib/kms/kms-client';
import { evaluateRecipientUnwrap } from '../../../../../lib/kms/unwrap-gate';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';

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

  // ---- Owner path ----
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }

  try {
    await assertOwns(ownerId, 'vault_items', vault_item_id);
  } catch {
    return NextResponse.json({ error: 'Forbidden', message: 'Not the item owner' }, { status: 403 });
  }

  const plaintextDataKey = await decryptDataKey(wrapped_data_key);
  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'kms_unwrap',
    entity: 'vault_item',
    entityId: vault_item_id,
    detail: { outcome: 'authorized' },
  });
  return NextResponse.json({ plaintext_data_key: plaintextDataKey });
}
