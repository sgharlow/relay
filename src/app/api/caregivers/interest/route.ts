/**
 * POST /api/caregivers/interest — G1 lead capture.
 *
 * PUBLIC AND UNAUTHENTICATED, by necessity: the visitor is a stranger who
 * arrived from an ad. That makes the defences here the only ones there are —
 * a per-IP rate limit, a honeypot field, hard length caps, and the fact that
 * the endpoint grants nothing and reveals nothing. It writes one row and sends
 * one email to ourselves.
 *
 * Returns 200 when EITHER the row or the notification succeeded, because the
 * lead is captured in that case. Only a double failure is a 500, which is the
 * client's cue to fall back to a mailto: link so the visitor is never dropped.
 *
 * Feature: relay-g1-wtp
 */

import { NextResponse, type NextRequest } from 'next/server';

import { recordLead, LeadValidationError, MAX_NOTE_LENGTH } from '../../../../../lib/g1/leads';
import { submissionSpeedVerdict } from '../../../../../lib/http/bot-signals';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';
import { readJson, isResponse } from '../../../../../lib/http/owner-route';

/** Generous for a human, tight for a script: 5 submissions per 10 minutes. */
const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;

/** Body larger than this is not a lead form submission. */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'lead'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: 'RateLimited', message: 'Too many attempts. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'TooLarge', message: 'That is too long.' }, { status: 413 });
  }

  /*
    The declared-length check above refuses before a byte is read, which is
    worth keeping — but Content-Length is a claim by the sender and a chunked
    request declares nothing. readJson enforces the same ceiling against the
    stream as it arrives, which is the half that was missing.
  */
  const parsed = await readJson(req, MAX_BODY_BYTES);
  if (isResponse(parsed)) return parsed;
  const body = parsed as Record<string, unknown>;

  // Honeypot: a field hidden from humans and irresistible to naive bots. A
  // filled value is answered with a normal-looking 200 so the bot has no signal
  // to adapt to, but nothing is recorded.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    process.stderr.write('[g1] lead discarded: honeypot filled\n');
    return NextResponse.json({ ok: true });
  }

  // Speed: a form completed faster than a person can read a label and type an
  // address. Also answered with a bland 200. Only an explicit 'too-fast' is
  // discarded — an absent or unreadable timestamp is allowed through, because
  // silently dropping real leads is far worse than absorbing some spam.
  if (submissionSpeedVerdict(body.renderedAt) === 'too-fast') {
    process.stderr.write('[g1] lead discarded: submitted faster than a human could type\n');
    return NextResponse.json({ ok: true });
  }

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.slice(0, MAX_NOTE_LENGTH) : undefined;

  try {
    const outcome = await recordLead({
      email: typeof body.email === 'string' ? body.email : '',
      note: str(body.note),
      src: str(body.src),
      cta: str(body.cta),
      // Which ad actually paid for this visitor. Absent for organic arrivals,
      // and never required — a lead without one is still a lead.
      clickPlatform: str(body.clickPlatform),
      clickId: str(body.clickId),
    });

    /*
      A refused write fails the request even though the email went out.

      The test below this line — "either leg succeeded, so report success" — is
      right for a transient blip: we have the caregiver's address, somebody will
      reply, and asking them to try again would serve us rather than them. It is
      wrong for a REFUSAL. 42501 does not heal, so a permanently unwritable
      caregiver_leads would report ok to every visitor while the number the G1
      gate reads stayed at zero, with nothing anywhere raising a fault.

      Failing here is what makes that visible: in production this 500 reaches
      `onRequestError` and alerts an operator, and against a credential that is
      deliberately denied this table (the planned relay_dev role) it is what
      makes the wall observable instead of silent.
    */
    if (outcome.storeDenied) {
      return NextResponse.json(
        { error: 'CaptureRefused', message: 'We could not save that. Please email us directly.' },
        { status: 500 },
      );
    }

    if (!outcome.stored && !outcome.notified) {
      return NextResponse.json(
        { error: 'CaptureFailed', message: 'We could not save that. Please email us directly.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LeadValidationError) {
      return NextResponse.json({ error: 'ValidationError', message: err.message }, { status: 400 });
    }
    throw err;
  }
}
