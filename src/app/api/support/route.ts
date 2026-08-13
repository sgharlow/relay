/**
 * POST /api/support — a person asking for help.
 *
 * 🔴 THERE WAS NO SUPPORT PATH AT ALL until 2026-08-13, which matters more here
 * than for most products: Relay is deliberately unrecoverable, so the people who
 * most need to reach a human are exactly the people nothing in the product can
 * rescue. Steve's direction: the FAQ answers what it can, and everything else
 * reaches him by email until an assistant exists.
 *
 * The same protections as the interest form, for the same reasons — this is a
 * public, unauthenticated POST that sends mail, which is the shape spam looks
 * for. Rate limit, bounded body, honeypot. It is deliberately NOT the interest
 * endpoint: support traffic landing in the lead funnel would corrupt the G1
 * measurement, and the two have different destinations and different urgency.
 *
 * NOTHING SENSITIVE IS ACCEPTED OR FORWARDED. No vault contents, no codes, no
 * tokens — the form asks for a message and a reply address and nothing else, and
 * the answer to "my code does not work" is never "paste the code here". A
 * support mailbox that accumulates credentials is a target; this one holds
 * nothing worth stealing.
 *
 * Feature: relay-h0-mvp
 */

import { NextResponse, type NextRequest } from 'next/server';

import { rateLimit, clientKey } from '../../../../lib/http/rate-limit';
import { sendEmailBestEffort } from '../../../../lib/notify/email';
import { CONTACT_EMAIL } from '../../../../lib/contact';
import { readJson, isResponse } from '../../../../lib/http/owner-route';

/** Generous for a person in difficulty, tight for a script. */
const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;

/** A body larger than this is not somebody asking a question. */
const MAX_BODY_BYTES = 8 * 1024;
const MAX_MESSAGE = 4000;
const MAX_EMAIL = 254;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'support'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      {
        error: 'RateLimited',
        message: 'Too many messages just now. Please wait a moment, or email us directly.',
      },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'TooLarge', message: 'That message is too long to send this way.' },
      { status: 413 },
    );
  }

  /*
    THE DECLARED-LENGTH CHECK ABOVE IS HALF A GUARD, and read-json-limit.test.ts
    says so in as many words: Content-Length is a claim by the sender, and a
    chunked request declares nothing at all. It is kept because it is free, it
    refuses before a byte is read, and its wording is better than a generic one
    for somebody who is already having a bad day. readJson enforces the same
    ceiling against the stream as it actually arrives, which is the half that
    was missing.
  */
  const parsed = await readJson(req, MAX_BODY_BYTES);
  if (isResponse(parsed)) return parsed;
  const body = parsed as Record<string, unknown>;

  // Honeypot, as on the interest form: hidden from people, irresistible to naive
  // bots. Answered with an ordinary 200 so there is no signal to adapt to.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    process.stderr.write('[support] discarded: honeypot filled\n');
    return NextResponse.json({ ok: true });
  }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
  const replyTo = typeof body.email === 'string' ? body.email.trim().slice(0, MAX_EMAIL) : '';
  /** Which screen they were on. Context for the reply, never anything private. */
  const from = typeof body.from === 'string' ? body.from.trim().slice(0, 120) : '';

  if (!message) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'Please tell us what is happening.' },
      { status: 400 },
    );
  }
  if (!replyTo.includes('@')) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'We need an address to reply to.' },
      { status: 400 },
    );
  }

  /*
    The reply address goes in the BODY, not the From header. Sending as the
    visitor would fail SPF for relaystandby.com and, worse, teach the mail
    provider that this domain forges senders — which is the same reputation the
    release notices depend on.
  */
  const delivered = await sendEmailBestEffort({
    to: CONTACT_EMAIL,
    subject: `Relay support — ${replyTo}`,
    text:
      `From: ${replyTo}\n` +
      (from ? `Page: ${from}\n` : '') +
      `\n${message}\n\n` +
      `— sent from the help page. Reply to the address above.\n`,
  });

  /*
    A send failure is reported honestly rather than swallowed. Everywhere else in
    this codebase mail is best-effort because the operation must not depend on
    it; here the message IS the operation, and a cheerful confirmation for a
    message that never left would leave somebody waiting for an answer that is
    not coming. The client falls back to a mailto on this response.
  */
  if (!delivered) {
    return NextResponse.json(
      { error: 'SendFailed', message: 'That did not send.', contact: CONTACT_EMAIL },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
