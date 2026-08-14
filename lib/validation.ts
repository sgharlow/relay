/**
 * Shared validation error for owner-resource API input.
 *
 * Routes map this to HTTP 400 with `{ error, message, field }`. Used by the
 * recipients / verifiers / access-rules modules. (lib/vault keeps its own copy
 * predating this file.)
 *
 * Feature: relay-h0-mvp
 */

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * The longest a person's name may be.
 *
 * Matches MAX_DISPLAY_NAME_LENGTH in lib/auth/signup.ts, which bounds the
 * owner's own name for the same reason. Generous for a real name — the longest
 * in common records run to about sixty characters — and far below anything
 * meant as a payload.
 */
export const MAX_PERSON_NAME_LENGTH = 80;

/**
 * A name, made safe to put in an email.
 *
 * 🔴 A CONTACT'S NAME WAS UNBOUNDED AND UNSANITISED until 2026-08-13.
 * `validateRecipientInput` and `validateVerifierInput` asked only
 * `isNonEmptyString`, and the value lands in the body of a message Relay sends
 * from its own domain — `Hi ${name},` — while the owner's display name lands in
 * the SUBJECT. So an authenticated caller controlled the recipient, the subject
 * line and the opening line of mail with valid SPF and DKIM.
 *
 * THE SAME CLASS WAS ALREADY CLOSED ONCE, on the access-request `reason`
 * (lib/release/access-request.ts, 2026-08-12): newlines let a sender end the
 * quoted section visually and continue in text that reads as Relay's own. A name
 * is a worse place for it than a reason, because a name is not presented as a
 * quotation at all — it simply looks like part of the message.
 *
 * WHITESPACE COLLAPSES rather than being rejected. A pasted name with a stray
 * newline is an ordinary accident and refusing it teaches nothing; a name that
 * needs a line break is not a name. Length is REFUSED rather than truncated,
 * matching the display-name rule — silently shortening what somebody will be
 * recognised by is worse than saying it did not fit.
 *
 * ⚠️ IT DOES NOT STRIP CONTROL CHARACTERS BEYOND WHITESPACE, and does not need
 * to: the value reaches a plain-text body and a JSON-encoded header field, never
 * markup and never a raw SMTP header this process assembles.
 */
export function cleanPersonName(v: unknown, field = 'name'): string {
  if (!isNonEmptyString(v)) throw new ValidationError(`${field} is required`, field);

  const collapsed = v.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) throw new ValidationError(`${field} is required`, field);

  if (collapsed.length > MAX_PERSON_NAME_LENGTH) {
    throw new ValidationError(
      `${field} must be ${MAX_PERSON_NAME_LENGTH} characters or fewer`,
      field,
    );
  }

  return collapsed;
}

/**
 * Every id column in the schema is a UUID, so an id that is not one can only
 * ever be a caller mistake — and before this existed it travelled all the way
 * to the driver, which raised SQLSTATE 22P02 and surfaced as a 500.
 *
 * `mapError` catches 22P02 as a backstop for the whole class; this exists so a
 * route can refuse the value at the edge and name the offending FIELD, which
 * the driver error cannot.
 *
 * Matches the canonical 8-4-4-4-12 form the app generates, case-insensitively.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
