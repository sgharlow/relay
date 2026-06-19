/**
 * Shared helpers for owner-scoped API route handlers.
 *
 * Collapses the repeated auth + error-mapping boilerplate used by the
 * recipients / verifiers / rules routes:
 *   - requireOwner()  → { ownerId } or the 401 NextResponse to return
 *   - readJson(req)    → parsed body or a 400 NextResponse
 *   - mapError(err)    → 400 for ValidationError, 403 for IntegrityError; rethrow otherwise
 *
 * Feature: relay-h0-mvp
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getOwnerSession } from '../auth/session';
import { ValidationError } from '../validation';
import { IntegrityError } from '../db/integrity';

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/** Returns `{ ownerId }` or a 401 NextResponse the caller should return. */
export async function requireOwner(): Promise<{ ownerId: string } | NextResponse> {
  try {
    const { ownerId } = await getOwnerSession();
    return { ownerId };
  } catch (res) {
    return res as NextResponse;
  }
}

/** Parses JSON, returning the body or a 400 NextResponse. */
export async function readJson(req: NextRequest): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid JSON body' }, { status: 400 });
  }
}

/** Maps a thrown validation/integrity error to a response; rethrows anything else. */
export function mapError(err: unknown): NextResponse {
  if (err instanceof ValidationError) {
    return NextResponse.json(
      { error: 'ValidationError', message: err.message, field: err.field },
      { status: 400 },
    );
  }
  if (err instanceof IntegrityError) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Not authorized for a referenced resource' },
      { status: 403 },
    );
  }
  throw err;
}
