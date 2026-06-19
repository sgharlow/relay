/**
 * POST /api/access/[itemId]/decrypt — Recipient item decryption.
 *
 * Auth: a recipient JWT (Authorization: Bearer, or `token` in the body). Verifies
 * RELEASED + version + an access_rule covering the item BEFORE calling KMS
 * (Req 7.5); audits every request authorized/denied (Req 7.8). Returns
 * { plaintext_data_key, ciphertext, kms_key_id } for the browser's AES-GCM decrypt.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.5, 7.8, 2.5
 */

import { NextResponse, type NextRequest } from 'next/server';
import { decryptAccessItem, AccessError } from '../../../../../../lib/access/dashboard';

type Ctx = { params: { itemId: string } };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : body.token;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Recipient token required' }, { status: 401 });
  }

  try {
    return NextResponse.json(await decryptAccessItem(token, params.itemId));
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'AccessError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
