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

/**
 * The default ceiling on a request body.
 *
 * 🔴 THERE WAS NO CEILING AT ALL until 2026-08-13. This helper called
 * `req.json()` with no size check and is shared by twenty-six route handlers, so
 * the only bound anywhere was Vercel's platform limit. A standby contact — the
 * actor `lib/release/access-request.ts` already names as the threat, "a named
 * contact who accepted, then turned hostile" — could post megabytes and make the
 * server parse all of it. The ReDoS fix in 32027b5 bounded the COST of handling
 * a hostile body; this bounds the body.
 *
 * 128 KB is roughly forty times the largest ordinary request. Measured: one
 * encrypted vault item with a 2 KB plaintext serialises to ~3.2 KB, and every
 * route here except /api/import sends one object.
 */
export const MAX_JSON_BYTES = 128 * 1024;

/**
 * The ceiling for the two routes that carry an encrypted vault item.
 *
 * MEASURED, NOT GUESSED. A vault item with a 2 KB plaintext serialises to about
 * 3.2 KB — but the plaintext is whatever the owner typed, and "the instructions
 * for closing my father's business" is a legitimate several-thousand-word note.
 * Ciphertext is base64 over AES-GCM output, so it runs roughly 4/3 of the
 * plaintext plus a tag; 128 KB would start refusing genuine notes somewhere
 * around 90 KB of typing, which is a real thing a real person could write and a
 * terrible way to find that out.
 *
 * 1 MB is roughly three hundred times the ordinary item and still bounded,
 * which is the whole point — the previous state was not "a generous limit", it
 * was no limit at all.
 *
 * /api/import keeps its own larger override: it posts a whole password-manager
 * export rather than one item.
 */
export const VAULT_MAX_JSON_BYTES = 1024 * 1024;

/**
 * Parses JSON, returning the body or a NextResponse (400 malformed, 413 too big).
 *
 * BOUNDED BY READING, not by trusting the header. A declared Content-Length is
 * checked first because it is free and lets an oversized request be refused
 * before a byte of body is read — but it is a claim by the sender, and a chunked
 * request declares nothing at all. So the stream is also counted as it arrives
 * and abandoned the moment it crosses the cap. Either check alone is a hole.
 *
 * 🔴 IT NEVER RETURNS `null`, AND THAT IS A FIX RATHER THAN A DETAIL.
 * `JSON.parse('null')` succeeds, so a four-byte body of `null` used to come back
 * as the value `null` — past the `isResponse` check, into a handler written as
 * `const body = parsed as { code?: unknown }`, and straight into
 * `TypeError: Cannot read properties of null` on the following line. Six
 * handlers carried that shape and four of them are PUBLIC: `/api/access/code`,
 * `/api/access/resend`, `/api/verify/code` and `/api/verify/resend` — the typed
 * code doors into a live release. An unhandled 500 where a 400 was intended,
 * from a body anyone could send.
 *
 * The hazard was already known: `readJsonOptional` below has ended `?? {}` since
 * it was written, with a comment saying exactly why. Normalising there and not
 * here left every caller of this one to remember, and six did not — a guard that
 * lives in a helper is a guard on the helper. Fixed 2026-08-22, at the helper
 * rather than at six call sites, and held to the same contract as its sibling by
 * `read-json-null-body.test.ts`.
 *
 * ⚠️ ONLY `null`/`undefined` are normalised. An array survives as an array
 * (/api/import posts one) and so does every falsy scalar — `0`, `false`, `""` —
 * because "callers can dereference the result" is the claim being made, not
 * "everything is an object".
 *
 * @param maxBytes override for a route that legitimately sends more; see
 *   /api/import, which posts a whole password-manager export.
 */
export async function readJson(
  req: NextRequest,
  maxBytes: number = MAX_JSON_BYTES,
): Promise<unknown | NextResponse> {
  const tooLarge = () =>
    NextResponse.json(
      {
        error: 'PayloadTooLarge',
        message: `That request is too large. The limit is ${Math.floor(maxBytes / 1024)} KB.`,
      },
      { status: 413 },
    );

  /**
   * The single exit for a successfully parsed body. There are TWO of them — the
   * no-stream fallback and the metered path — and `?? {}` is applied here rather
   * than written out at each, because a fix applied to one of two return sites
   * is the same defect one layer down.
   */
  const parsed = (v: unknown): unknown => v ?? {};

  /*
    Optional chaining on both because this is called with request DOUBLES in
    route tests — `{ json: async () => body }` and nothing else. Under the real
    runtime `headers` is always present and a body-bearing request always has a
    stream, so the guard always engages where it matters; the fallback below
    exists so a unit test does not have to construct a whole Request to exercise
    a handler. A test asserts that shape keeps working.
  */
  const declared = Number(req.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  try {
    const body = req.body;
    // Nothing to meter — an empty body, a test double, or a runtime that does
    // not expose a stream. The declared-length check above is then the only
    // guard, which is correct: there is no stream to read.
    if (!body) return parsed(await req.json());

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }

    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      joined.set(c, at);
      at += c.byteLength;
    }
    return parsed(JSON.parse(new TextDecoder().decode(joined)));
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: 'Invalid JSON body' }, { status: 400 });
  }
}

/**
 * `readJson` for the handlers that tolerate a missing or malformed body.
 *
 * WHY THIS EXISTS RATHER THAN JUST CALLING readJson EVERYWHERE. Six handlers
 * were written as `await req.json().catch(() => ({}))` — deliberately, because
 * their body is optional. A verifier confirming a release and a claimed
 * recipient opening an item both legitimately POST nothing at all. Swapping
 * those to `readJson` would have started answering 400 to a request that has
 * always been valid, which is a regression dressed up as a security fix.
 *
 * So the tolerant contract is preserved exactly: absent body, empty body,
 * malformed JSON — all still become `{}`. The ONLY refusal that survives is
 * 413, because that is the guard being added and the entire reason to touch
 * these files.
 *
 * Feature: relay-h0-mvp
 */
export async function readJsonOptional(
  req: NextRequest,
  maxBytes: number = MAX_JSON_BYTES,
): Promise<unknown | NextResponse> {
  const out = await readJson(req, maxBytes);
  if (isResponse(out)) return out.status === 413 ? out : {};
  // A body of literal `null` parses successfully to null; callers expect an
  // object to read optional fields off.
  return out ?? {};
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
