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

  const result = await getClient().emails.send({
    from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
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
