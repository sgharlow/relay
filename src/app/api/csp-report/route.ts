/**
 * POST /api/csp-report — the browser saying what the policy WOULD have blocked.
 *
 * The whole point of shipping Content-Security-Policy in report-only mode is
 * that the policy is a guess until real traffic argues with it. This is where
 * the argument arrives. Without it the header is theatre: report-only with
 * nowhere to report is a header that does nothing at all.
 *
 * UNAUTHENTICATED BY NECESSITY, like /api/incident — the browser posts this on
 * its own, from whatever page tripped the policy, with no session attached. So
 * it is bounded and its answer never varies.
 *
 * ⚠️ IT LOGS A DIRECTIVE AND A URI, NEVER THE PAGE'S CONTENT. A CSP report can
 * carry `script-sample` — up to 40 characters of the offending inline script —
 * and on a page that has just decrypted a vault item, forty characters of the
 * DOM is not something to email anywhere. It is dropped, explicitly, rather
 * than merely not being read.
 *
 * Feature: relay-h0-mvp
 */

import { NextResponse, type NextRequest } from 'next/server';

import { rateLimit, clientKey } from '../../../../lib/http/rate-limit';
import { readJson, isResponse } from '../../../../lib/http/owner-route';
import { recordCspViolation } from '../../../../lib/ops/csp-report-store';

/** A browser sends one of these per violation; a broken page can send many. */
const LIMIT = 20;
const WINDOW_MS = 60 * 1000;

/** Reports are small. Anything larger is not a browser. */
const MAX_REPORT_BYTES = 8 * 1024;

/** Enough to identify a violation, short enough not to be a channel. */
const MAX_FIELD = 200;

function short(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_FIELD) : null;
}

/**
 * Both report shapes, because browsers disagree.
 *
 * `report-uri` sends `{ "csp-report": {...} }` with kebab-case keys; the newer
 * Reporting API sends an ARRAY of `{ type, body }` with camelCase. Supporting
 * only one means silently collecting nothing from half the browsers — which
 * would look exactly like a clean policy.
 */
function violations(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body
      .filter((r): r is { type?: string; body?: Record<string, unknown> } => typeof r === 'object' && r !== null)
      .filter((r) => r.type === undefined || r.type === 'csp-violation')
      .map((r) => r.body ?? {});
  }
  if (typeof body === 'object' && body !== null && 'csp-report' in body) {
    const inner = (body as { 'csp-report': unknown })['csp-report'];
    return typeof inner === 'object' && inner !== null ? [inner as Record<string, unknown>] : [];
  }
  return [];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Always 204. A reporting endpoint that answers differently is a reporting
  // endpoint that can be probed, and the browser does nothing with the response.
  const ok = new NextResponse(null, { status: 204 });

  if (!rateLimit(clientKey(req.headers, 'csp'), LIMIT, WINDOW_MS).allowed) return ok;

  const parsed = await readJson(req, MAX_REPORT_BYTES);
  if (isResponse(parsed)) return ok;

  for (const v of violations(parsed)) {
    const directive = short(v['effective-directive'] ?? v.effectiveDirective ?? v['violated-directive']);
    const blocked = short(v['blocked-uri'] ?? v.blockedURL);
    const document = short(v['document-uri'] ?? v.documentURL)?.split('?')[0] ?? null;

    /*
      🔴 THE FIELD THAT MAKES THE REST WORTH STORING. Since 2026-08-20 this
      product ships TWO policies: an enforcing one and a stricter report-only one
      (script-src without 'unsafe-inline'/'unsafe-eval' — the nonce question).
      Both report here, in the same shape.

      `enforce` means something was ACTUALLY BLOCKED on the live site and a user
      may have seen a broken page. `report` means the stricter policy WOULD have
      blocked it and nothing broke. Those demand completely different responses,
      and without this field they are indistinguishable.
    */
    const disposition = short(v.disposition);

    /*
      script-sample / sample is deliberately NOT read. See the header: it is a
      slice of the page, and this product's pages hold decrypted plaintext.
    */
    try {
      process.stderr.write(
        `[csp] ${disposition ?? '?'} directive=${directive ?? '?'} blocked=${blocked ?? '?'} at=${document ?? '?'}\n`,
      );
    } catch {
      /* a broken stderr must not escalate */
    }

    /*
      Durable, because stderr forgets in about a day and the whole purpose of a
      report-only period is to accumulate evidence. Awaited so a serverless
      instance is not frozen mid-write, and incapable of throwing by construction
      — see the module header.
    */
    await recordCspViolation({ disposition, directive, blocked, document });
  }

  return ok;
}
