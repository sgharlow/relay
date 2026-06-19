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

/** Sends one email. Throws on misconfiguration or a Resend error. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!from) throw new Error('RESEND_FROM_ADDRESS environment variable is not set');
  await getClient().emails.send({ from, to: msg.to, subject: msg.subject, text: msg.text });
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
