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
import { alertEnvironmentLabel } from '../ops/alert-address';

export const MAX_NOTE_LENGTH = 1000;

/**
 * Click identifiers are bounded here, not just in the browser. The browser cap
 * is a convenience for our own code; this endpoint is public and unauthenticated,
 * so the only cap that counts is this one.
 */
export const MAX_CLICK_ID_LENGTH = 255;
export const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical maximum

export interface LeadInput {
  email: string;
  note?: string;
  src?: string;
  cta?: string;
  /** The ad platform that sold the click, when there was one. */
  clickPlatform?: string;
  /** That platform's identifier for the click. Never required — organic
      arrivals have none, and a lead without one is still a lead. */
  clickId?: string;
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

/**
 * Whether this lead was generated somewhere that cannot produce real demand.
 *
 * 🔴 A LEAD IS NOT REALLY AN EMAIL — it is the G1 gate's measurement arriving
 * in an inbox. `PROJECT.yaml` calls `caregiver_leads` "the input to the G1 gate
 * — the measurement that decides whether the product has a market", and the
 * whole worth of that number is that it is ARMS-LENGTH. A lead the team
 * generated is precisely the opposite of the thing being measured.
 *
 * Nothing stops a `next dev` server producing one: `.env.local` carries the
 * production Resend key and points at the production cluster, because Relay has
 * no dev database. Submitting the landing form on a laptop therefore mails the
 * real operator inbox and writes a real row, and on 2026-08-15 the sibling case
 * proved the inbox believes what it is told — an ops alert from a dev server
 * announced itself as production and was read as one.
 *
 * So the notification says where it came from. It does NOT block the write:
 * whether a dev server may record a G1 lead at all is a gate decision, and
 * suppressing only the email would hide a contaminated row instead of
 * preventing one. Marking is the honest half that is safe to do unilaterally.
 */
function nonProductionOrigin(): string | undefined {
  const label = alertEnvironmentLabel();
  return label === 'production' ? undefined : label;
}

function composeNotification(lead: { email: string; note?: string }, input: LeadInput): string {
  const origin = nonProductionOrigin();

  return [
    ...(origin
      ? [
          `⚠️ THIS LEAD WAS NOT GENERATED IN PRODUCTION (${origin}).`,
          `It is somebody testing, not demand. Do not count it toward G1.`,
          ``,
        ]
      : []),
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
      const origin = nonProductionOrigin();
      await sendEmail({
        to,
        // The marker leads the subject, because that is the part read in a
        // notification list without opening anything.
        subject:
          (origin ? `[NOT PRODUCTION: ${origin}] ` : '') +
          `Relay lead — ${lead.email}${input.src ? ` (${input.src})` : ''}`,
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
      `INSERT INTO caregiver_leads (email, note, src, cta, notified, click_platform, click_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        lead.email,
        lead.note ?? null,
        input.src ?? null,
        input.cta ?? null,
        notified,
        input.clickPlatform?.slice(0, MAX_CLICK_ID_LENGTH) ?? null,
        input.clickId?.slice(0, MAX_CLICK_ID_LENGTH) ?? null,
      ],
    );
    stored = true;
  } catch (err) {
    process.stderr.write(`[g1] lead persist failed for ${lead.email}: ${String(err)}\n`);
  }

  return { stored, notified };
}
