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
import { byteaToBase64 } from '../../../../../lib/db/bytea';
import { resolveActor, assertDelegateMayRead } from '../../../../../lib/http/delegate-route';
import { readJson, isResponse } from '../../../../../lib/http/owner-route';
import { IntegrityError } from '../../../../../lib/db/integrity';

/**
 * 🔴 THE SERVER, NOT THE CALLER, DECIDES WHICH BLOB IS UNWRAPPED.
 *
 * Until 2026-08-13 both paths of this route authorised on `vault_item_id` and
 * then decrypted `body.wrapped_data_key` — an arbitrary blob from the request.
 * The CMK is one key shared across every tenant and the KMS Decrypt call names
 * no key and carries no EncryptionContext, so KMS will unwrap ANY ciphertext
 * under that CMK. An owner of a single item they created could therefore submit
 * `{ vault_item_id: <their item>, wrapped_data_key: <another tenant's leaked
 * blob> }` and receive that tenant's plaintext data key — with the audit log
 * dutifully attesting the decrypt against the caller's OWN item, so the chain
 * stayed intact while recording the wrong thing.
 *
 * That collapses the product's core promise: CLAUDE.md says the server stores
 * only ciphertext + wrapped_data_key, the point being that a DSQL
 * leak/backup/snapshot stays sealed. With a body-trusting oracle, leaked rows
 * plus a free account equal plaintext data keys for every tenant.
 *
 * The recipient dashboard path (lib/access/dashboard.ts) never had this hole —
 * it loads the wrapped key from the row by id. This makes the KMS proxy do the
 * same: the authorised `vault_item_id` is the ONLY input to the decrypt, and the
 * body's `wrapped_data_key` is now ignored. The client still sends it; it is
 * simply no longer trusted.
 *
 * Returns the row's wrapped key and the era it was wrapped under, or null when
 * the item does not exist — a caller-supplied id that names no row is a 403,
 * never a decrypt of something they handed us. Scoped by owner_id so the lookup
 * cannot read across owners.
 *
 * `kms_context_era` comes back in the SAME select as the blob, deliberately: it
 * is a fact about the row, and a caller-supplied era would be a caller-supplied
 * instruction to skip the context. Every row reads NULL today (phase B), so
 * every decrypt below still takes the legacy path.
 */
async function storedWrappedKey(
  itemId: string,
  ownerId: string,
): Promise<{ wrappedDataKey: string; era: string | null } | null> {
  const row = await query<{ wrapped_data_key: unknown; kms_context_era: string | null }>(
    `SELECT wrapped_data_key, kms_context_era FROM vault_items WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [itemId, ownerId],
  );
  if (row.rowCount === 0 || row.rows.length === 0) return null;
  return {
    wrappedDataKey: byteaToBase64(row.rows[0].wrapped_data_key),
    era: row.rows[0].kms_context_era ?? null,
  };
}

/**
 * The item's STORED blob and provenance — the only bytes this route decrypts.
 *
 * 🔴 THE ROUTE USED TO DECRYPT WHATEVER THE CALLER SENT. Both paths gated
 * carefully on `vault_item_id` and then passed `body.wrapped_data_key` —
 * caller-supplied bytes — to KMS Decrypt. Nothing bound the blob to the item
 * the gate had just authorized, the CMK is shared across every tenant, and a
 * KMS Decrypt without an EncryptionContext unwraps any blob generated under
 * that key. So any self-serve signup with one vault item of their own was a
 * decrypt oracle for every tenant's wrapped keys: authorize against

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
  /*
    BOUNDED BEFORE ANYTHING ELSE. This handler parses a body BEFORE it
    authenticates — it has to, because the recipient token may arrive in that
    body rather than a header. That makes it the one route where an unbounded
    parse was reachable by anyone at all, and it was: it called req.json()
    directly and never saw the 128 KB cap the other twenty-six routes share.
  */
  const parsed = await readJson(req);
  if (isResponse(parsed)) return parsed;
  const body = parsed as UnwrapBody;

  const { vault_item_id } = body;
  // wrapped_data_key is still accepted in the body for backward compatibility
  // with the client, but it is NEVER decrypted — the server loads the blob it
  // will actually unwrap from the authorised row. Only the item id is required.
  if (!vault_item_id) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'vault_item_id is required' },
      { status: 400 },
    );
  }

  // ---- Recipient path (scoped token in Authorization header or body) ----
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : body.recipient_token;

  if (token) {
    let payload;
    try {
      payload = await verifyRecipientToken(token);
    } catch {
      return NextResponse.json({ error: 'Forbidden', message: 'Invalid recipient token' }, { status: 403 });
    }

    const { allowed, ownerId } = await evaluateRecipientUnwrap({
      recipientId: payload.recipientId,
      vaultItemId: vault_item_id,
      releaseStateId: payload.releaseStateId,
    });

    if (!allowed || !ownerId) {
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

    // Server-authoritative blob: the gate proved this recipient may read this
    // item under this owner, so the key we unwrap is the one stored on that row.
    const stored = await storedWrappedKey(vault_item_id, ownerId);
    if (stored === null) {
      return NextResponse.json({ error: 'Forbidden', message: 'Access not permitted' }, { status: 403 });
    }
    const plaintextDataKey = await decryptDataKey(stored.wrappedDataKey, {
      era: stored.era,
      ownerId,
    });
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

  // Same rule as the recipient path: assertOwns proved ownership, so the blob
  // to unwrap is the one on that row — never the caller's body.
  const stored = await storedWrappedKey(vault_item_id, ownerId);
  if (stored === null) {
    return NextResponse.json({ error: 'Forbidden', message: 'Not the item owner' }, { status: 403 });
  }
  const plaintextDataKey = await decryptDataKey(stored.wrappedDataKey, {
    era: stored.era,
    ownerId,
  });
  await writeAuditEntry(ownerId, {
    actor: actor.isDelegate ? `delegate:${actor.delegationId}` : `owner:${ownerId}`,
    action: 'kms_unwrap',
    entity: 'vault_item',
    entityId: vault_item_id,
    detail: { outcome: 'authorized' },
  });
  return NextResponse.json({ plaintext_data_key: plaintextDataKey });
}
