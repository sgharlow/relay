/**
 * GET /api/account/export — take your data out (J13).
 *
 * Returns ciphertext, not plaintext. The server cannot read vault contents, so
 * the only place a useful export can be assembled is the browser that can
 * decrypt; this hands over the material and the client finishes the job. A
 * server-side plaintext export would break the guarantee the product is sold on.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { buildAccountExport } from '../../../../../lib/account/lifecycle';

/**
 * This handler takes no request argument, so Next would otherwise try to
 * prerender it at build time — which means running a vault query with no
 * session against no database, and failing the build.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  return NextResponse.json(await buildAccountExport(auth.ownerId));
}
