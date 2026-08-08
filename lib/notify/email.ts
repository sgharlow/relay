/**
 * Email delivery via Resend (Requirements 4.4, 6.2, 6.6).
 *
 * Thin boundary so routes/tests mock one seam. `sendEmail` throws on failure;
 * callers that must not let a mail failure roll back a state transition use
 * `sendEmailBestEffort`, which logs and swallows.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2
 */

import { Resend } from 'resend';

let _client: Resend | null = null;

function getClient(): Resend {
  if (!_client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY environment variable is not set');
    _client = new Resend(key);
  }
  return _client;
}

/** Test seam — inject a stub Resend client (or null to reset). */
export function _setResendClientForTesting(client: Resend | null): void {
  _client = client;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Overrides RESEND_REPLY_TO_ADDRESS for this one message. */
  replyTo?: string;
}

/**
 * The address a recipient reaches by hitting reply.
 *
 * This is NOT cosmetic. `relaystandby.com` has no apex MX record, so the From
 * address — relay@relaystandby.com — cannot receive mail at all. Without a
 * Reply-To header, a caregiver who reads "someone is requesting access to your
 * parent's vault" and replies is writing to a mailbox that does not exist, and
 * gets a bounce instead of a person. For a product whose entire proposition is
 * trust, that is the worst possible failure.
 *
 * A Reply-To pointing at a real inbox fixes this today, without waiting on
 * inbound-mail DNS. When Cloudflare Email Routing is enabled (see
 * docs/email-dns-runbook.md) this can point at relay@relaystandby.com instead;
 * nothing else needs to change.
 *
 * Returns undefined when unset — an absent header is correct, an empty one is
 * malformed.
 */
function resolveReplyTo(explicit?: string): string | undefined {
  const addr = explicit ?? process.env.RESEND_REPLY_TO_ADDRESS;
  const trimmed = addr?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Sends one email. Throws on misconfiguration or a Resend error.
 *
 * ⚠️ The Resend SDK does NOT throw on API errors — it resolves with
 * `{ data, error }`. This function previously awaited that promise and returned
 * without inspecting either field, so EVERY failed send was reported as a
 * success: a rejected recipient, a restricted sending domain, an invalid
 * address and a rate-limit all looked identical to delivery.
 *
 * The consequence was total and silent. `sendEmailBestEffort` never logged,
 * because there was never an exception to catch, and a live test send to
 * `example.org` — a reserved domain that cannot receive mail — was reported
 * delivered. Found 2026-08-07 when a real test email never arrived.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!from) throw new Error('RESEND_FROM_ADDRESS environment variable is not set');

  const replyTo = resolveReplyTo(msg.replyTo);

  const result = await getClient().emails.send({
    from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    ...(replyTo ? { replyTo } : {}),
  });

  // The error field is the ONLY signal that a send failed.
  if (result?.error) {
    const e = result.error as { name?: string; message?: string };
    throw new Error(`Resend rejected the send: ${e.name ?? 'error'} — ${e.message ?? 'no message'}`);
  }

  // A success carries an id. Its absence means we cannot claim delivery.
  if (!result?.data?.id) {
    throw new Error('Resend returned no message id; the send cannot be considered accepted');
  }
}

/** Sends one email, swallowing+logging any failure (never throws). */
export async function sendEmailBestEffort(msg: EmailMessage): Promise<boolean> {
  try {
    await sendEmail(msg);
    return true;
  } catch (err) {
    process.stderr.write(`[notify] email to ${msg.to} failed: ${String(err)}\n`);
    return false;
  }
}
