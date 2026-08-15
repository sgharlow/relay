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

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { requireStepUp } from '../../../../../lib/auth/step-up';
import { buildAccountExport } from '../../../../../lib/account/lifecycle';

/**
 * Reads a session and a cookie, so Next must never prerender it at build time —
 * which would mean running a vault query with no session against no database.
 */
export const dynamic = 'force-dynamic';

/**
 * STEP-UP GUARDED. This is the single request that hands over every wrapped key
 * in the vault; the browser then unwraps each one and writes the plaintext to
 * disk. A walked-away-from machine is one click from a complete, unprotected
 * copy of everything the product exists to protect, and the file it produces
 * says so itself ("it is not protected once it leaves").
 *
 * The window is five minutes rather than one shot on purpose: a large vault
 * decrypts item by item, and an owner who hits a network error part-way through
 * should be able to press the button again without re-authenticating.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const elevate = await requireStepUp(req, auth.ownerId);
  if (elevate) return elevate;

  return NextResponse.json(await buildAccountExport(auth.ownerId));
}
