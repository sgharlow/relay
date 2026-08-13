/**
 * POST /api/incident — an error boundary reports that a real person hit a wall.
 *
 * UNAUTHENTICATED by necessity: the page that calls this is the page that just
 * failed, and it cannot assume a session survived. That makes it a spam surface,
 * so everything it accepts is bounded and nothing it returns varies.
 *
 * ⚠️ IT ACCEPTS A DIGEST, NEVER A MESSAGE. React supplies a production digest —
 * a hash — for exactly this, and the message could carry anything, including
 * something from near the crypto path. Refusing it here means no caller can
 * ever be talked into sending one.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7
 */

import { NextResponse, type NextRequest } from 'next/server';

import { reportIncident } from '../../../../lib/ops/incident';
import { rateLimit, clientKey } from '../../../../lib/http/rate-limit';
import { readJson, isResponse } from '../../../../lib/http/owner-route';

const LIMIT = 10;
const WINDOW_MS = 60 * 1000;

/** Bounded so a hostile caller cannot use the alert as a message channel. */
const MAX_DIGEST = 128;
const MAX_PATH = 256;
/**
 * The outer bound on the body, above the field caps rather than below them.
 *
 * ⚠️ SET TO 4 KB FIRST, AND THAT WAS WRONG. The field caps above exist so an
 * over-long digest is DROPPED — reported as null, with the incident still
 * recorded — and route.test.ts pins that with a 5 KB digest. A 4 KB parse cap
 * refused the whole request instead, so a page that genuinely failed stopped
 * reporting at all. The guard would have quietly cost monitoring signal on
 * exactly the pages it exists to watch.
 *
 * 16 KB keeps the two layers in the right order: anything a real reporter sends
 * is parsed and then trimmed by the field caps, and only a body far beyond any
 * plausible report is refused outright.
 */
const MAX_INCIDENT_BYTES = 16 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Always 204, whatever happens. The reporter is a dying page; there is nothing
  // useful it could do with an error about its error, and a varying response
  // would let this be probed.
  const ok = new NextResponse(null, { status: 204 });

  const { allowed } = rateLimit(clientKey(req.headers, 'incident'), LIMIT, WINDOW_MS);
  if (!allowed) return ok;

  /*
    Bounded at the parse, not only at the fields. The digest and path caps below
    trim what is KEPT; they do nothing about what is read, and this endpoint is
    unauthenticated by necessity. 4 KB is far more than the three short strings
    it accepts.

    A size refusal still answers 204. The rule at the top of this handler — the
    response never varies, whatever happens — applies to 413 exactly as it
    applies to malformed JSON, because a distinguishable answer is what makes an
    endpoint probeable.
  */
  const parsed = await readJson(req, MAX_INCIDENT_BYTES);
  if (isResponse(parsed)) return ok;
  const body = parsed as { digest?: unknown; path?: unknown; mode?: unknown };

  const digest =
    typeof body.digest === 'string' && body.digest.length <= MAX_DIGEST ? body.digest : null;
  const path =
    typeof body.path === 'string' && body.path.length <= MAX_PATH
      ? // Pathname only. A query string can carry a claim code or a token, and
        // this is the one place a URL would otherwise be copied into an email.
        body.path.split('?')[0]
      : 'unknown';
  const mode =
    body.mode === 'owner' || body.mode === 'access' || body.mode === 'public' ? body.mode : 'public';

  try {
    await reportIncident({ digest, path, mode });
  } catch {
    // Reporting a failure must never itself become a failure.
  }

  return ok;
}
