/**
 * POST /api/access/[itemId]/decrypt — Recipient item decryption.
 *
 * TWO ROUTES IN, ONE SET OF GATES. A CLAIMED recipient is signed in and needs no
 * token (hybrid+6, the primary path); an UNCLAIMED one still presents a recipient
 * JWT (Authorization: Bearer, or `token` in the body). Both land in the same
 * authorization core, which verifies RELEASED + an access_rule covering the item
 * BEFORE calling KMS (Req 7.5) and audits every request, authorized or denied
 * (Req 7.8). Returns { plaintext_data_key, ciphertext, kms_key_id } for the
 * browser's AES-GCM decrypt — the plaintext itself never exists on the server.
 *
 * The token is tried FIRST so this stays additive: a request that carries one
 * behaves exactly as it did before, which is what keeps the rollback a code
 * revert with no data change.
 *
 * Feature: relay-h0-mvp, relay-standby
 * Requirements: 7.5, 7.8, 2.5, J4-R9
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  decryptAccessItem,
  decryptAccessItemForUser,
  AccessError,
} from '../../../../../../lib/access/dashboard';
import { getOwnerSession } from '../../../../../../lib/auth/session';
import { readJsonOptional, isResponse } from '../../../../../../lib/http/owner-route';

type Ctx = { params: Promise<{ itemId: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const parsed = await readJsonOptional(req);
  if (isResponse(parsed)) return parsed;
  const body = parsed as { token?: string };
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : body.token;

  try {
    if (token) {
      return NextResponse.json(await decryptAccessItem(token, (await params).itemId));
    }

    const session = await getOwnerSession().catch(() => null);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Recipient token required' },
        { status: 401 },
      );
    }
    return NextResponse.json(
      await decryptAccessItemForUser(session.ownerId, (await params).itemId),
    );
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'AccessError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
