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
import { recordDeliberateActivity } from '../release/liveness';
import { getOwnerSession } from '../auth/session';
import { ValidationError } from '../validation';
import { IntegrityError } from '../db/integrity';

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/** Returns `{ ownerId }` or a 401 NextResponse the caller should return. */
/**
 * Authenticates a USER. (The name is inherited from when every session was an
 * owner; whether they own a vault is a separate question.)
 *
 * Pass `req` to also record passive liveness ([A4]) — writes count, reads do not.
 * ⚠️ COVERAGE IS OPT-IN AND THAT IS A KNOWN LIMIT: a route that does not pass
 * `req` records nothing. The structural answer is Node-runtime middleware over
 * /api/*, which was deliberately not added here — it changes the path of EVERY
 * request, and this data layer needs `pg`, so it cannot run on the Edge default.
 * Partial coverage is safe in the meantime: a missed stamp only ever errs toward
 * escalating, which is the safe direction.
 */
export async function requireOwner(
  req?: { method?: string },
): Promise<{ ownerId: string } | NextResponse> {
  try {
    const { ownerId } = await getOwnerSession();
    if (req?.method) {
      // Deliberately not awaited into the critical path beyond its own guard;
      // recordDeliberateActivity swallows its own failures.
      await recordDeliberateActivity({ userId: ownerId, method: req.method });
    }
    return { ownerId };
  } catch (res) {
    // getOwnerSession throws a 401 NextResponse by design. Anything else — a
    // TypeError, a session-backend outage — used to be returned as-is, which
    // isResponse() rejected, leaving the caller to carry on with
    // `ownerId: undefined`. That is fail-OPEN on an auth guard. Deny instead.
    if (isResponse(res)) return res;
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Valid owner session required' },
      { status: 401 },
    );
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
  // A malformed identifier is the CALLER's mistake, not a server fault. Every
  // id column is a UUID, so a non-UUID string reaches the driver and raises
  // SQLSTATE 22P02 — which this mapper used to rethrow, rendering a 500.
  // Nothing in the codebase validated UUID shape and 17 routes share this
  // mapper, so the fix belongs here rather than in each caller.
  //
  // The message is deliberately generic: the driver's text embeds the offending
  // value ("invalid input syntax for type uuid: \"…\""), and reflecting caller
  // input back is how probes get confirmed. It also stays distinct from the 403
  // above only by SHAPE, never by existence — a well-formed id that is missing
  // and a well-formed id owned by someone else both still return the same 403,
  // so this adds no enumeration oracle.
  if (isMalformedIdentifier(err)) {
    return NextResponse.json(
      { error: 'ValidationError', message: 'Malformed identifier' },
      { status: 400 },
    );
  }
  throw err;
}

/** Postgres/DSQL `invalid_text_representation`, confirmed against live DSQL. */
const INVALID_TEXT_REPRESENTATION = '22P02';

function isMalformedIdentifier(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === INVALID_TEXT_REPRESENTATION
  );
}
