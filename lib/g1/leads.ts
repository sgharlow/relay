/**
 * G1 caregiver lead capture.
 *
 * The paid funnel's only conversion point. Two independent records are written
 * for every lead — a `caregiver_leads` row and a notification email — because
 * either alone fails silently, and silent failure here is the expensive kind:
 * a broken capture path produces zero leads, which is exactly what genuine zero
 * demand produces, and the G1 gate kills the product below 0.5%. We must be
 * able to tell those apart.
 *
 * So: a lead survives if EITHER leg succeeds, and the caller only sees an error
 * when BOTH fail — at which point the UI falls back to a mailto: link rather
 * than dropping the visitor.
 *
 * Feature: relay-g1-wtp
 */

import { query } from '../db/connection';
import { sendEmail } from '../notify/email';

export const MAX_NOTE_LENGTH = 1000;
export const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical maximum

export interface LeadInput {
  email: string;
  note?: string;
  src?: string;
  cta?: string;
}

export interface LeadOutcome {
  /** The caregiver_leads row was written. */
  stored: boolean;
  /** Resend accepted the notification email. */
  notified: boolean;
}

export class LeadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadValidationError';
  }
}

/**
 * Deliberately permissive. This is a lead form, not an auth boundary: the cost
 * of rejecting a real caregiver's unusual-but-valid address is a lost customer,
 * while the cost of accepting a junk one is a row we ignore. Anything stricter
 * than "has a local part, an @, and a dotted domain" rejects real addresses.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Throws LeadValidationError with a message safe to show the visitor. */
export function validateLead(input: LeadInput): { email: string; note?: string } {
  const email = normaliseEmail(input.email ?? '');
  if (!email) throw new LeadValidationError('Please enter your email address.');
  if (email.length > MAX_EMAIL_LENGTH) throw new LeadValidationError('That email address is too long.');
  if (!EMAIL_SHAPE.test(email)) throw new LeadValidationError('That does not look like an email address.');

  const note = input.note?.trim();
  if (note && note.length > MAX_NOTE_LENGTH) {
    throw new LeadValidationError(`Please keep it under ${MAX_NOTE_LENGTH} characters.`);
  }

  return { email, note: note || undefined };
}

/** Where lead notifications go. Falls back to the reply-to inbox. */
function notifyAddress(): string | undefined {
  const addr = (process.env.LEAD_NOTIFY_ADDRESS ?? process.env.RESEND_REPLY_TO_ADDRESS)?.trim();
  return addr || undefined;
}

function composeNotification(lead: { email: string; note?: string }, input: LeadInput): string {
  return [
    `New Relay caregiver lead.`,
    ``,
    `Email:   ${lead.email}`,
    `Channel: ${input.src ?? '(none)'}`,
    `CTA:     ${input.cta ?? '(none)'}`,
    ``,
    `Their situation:`,
    lead.note ?? '(not provided)',
    ``,
    `Reply directly to them — the landing page promises an answer within a day.`,
  ].join('\n');
}

/**
 * Records a lead. Never throws on a leg failure — inspect the outcome.
 * Throws only LeadValidationError, which is the visitor's fault and fixable.
 */
export async function recordLead(input: LeadInput): Promise<LeadOutcome> {
  const lead = validateLead(input);

  // Notify first so the row can record whether it worked. A lead the operator
  // never hears about is worse than one that is merely un-analysable later.
  let notified = false;
  const to = notifyAddress();
  if (to) {
    try {
      await sendEmail({
        to,
        subject: `Relay lead — ${lead.email}${input.src ? ` (${input.src})` : ''}`,
        text: composeNotification(lead, input),
        // Replying to the notification reaches the caregiver, not ourselves.
        replyTo: lead.email,
      });
      notified = true;
    } catch (err) {
      process.stderr.write(`[g1] lead notification failed for ${lead.email}: ${String(err)}\n`);
    }
  } else {
    process.stderr.write('[g1] no LEAD_NOTIFY_ADDRESS or RESEND_REPLY_TO_ADDRESS set; lead not emailed\n');
  }

  let stored = false;
  try {
    await query(
      `INSERT INTO caregiver_leads (email, note, src, cta, notified) VALUES ($1, $2, $3, $4, $5)`,
      [lead.email, lead.note ?? null, input.src ?? null, input.cta ?? null, notified],
    );
    stored = true;
  } catch (err) {
    process.stderr.write(`[g1] lead persist failed for ${lead.email}: ${String(err)}\n`);
  }

  return { stored, notified };
}
