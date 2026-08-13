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

const LIMIT = 10;
const WINDOW_MS = 60 * 1000;

/** Bounded so a hostile caller cannot use the alert as a message channel. */
const MAX_DIGEST = 128;
const MAX_PATH = 256;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Always 204, whatever happens. The reporter is a dying page; there is nothing
  // useful it could do with an error about its error, and a varying response
  // would let this be probed.
  const ok = new NextResponse(null, { status: 204 });

  const { allowed } = rateLimit(clientKey(req.headers, 'incident'), LIMIT, WINDOW_MS);
  if (!allowed) return ok;

  let body: { digest?: unknown; path?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return ok;
  }

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
