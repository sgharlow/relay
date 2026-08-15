/**
 * Reading a second address off a request body — the SAME rule for both rosters.
 *
 * Recipients and verifiers have separate validators by design, which is exactly
 * the shape where a new field gets wired on one side and forgotten on the
 * other. This is the one definition both call, so "what counts as a second
 * address" cannot come to mean two different things.
 *
 * Feature: relay-standby
 */

import { ValidationError, isEmailAddress } from '../validation';

export const SECONDARY_EMAIL_FIELD = 'email_secondary';

/**
 * THREE ANSWERS, NOT TWO, and the third one is the safety property.
 *
 *   undefined  the key was not in the body at all — "I have no opinion".
 *              Persistence leaves the stored value ALONE.
 *   null       the key was present and empty — "remove it". Clearing the field
 *              is how an owner takes a second address off somebody, so blank
 *              must not be an error or they could never undo it.
 *   string     a valid, different address.
 *
 * 🔴 WHY ABSENT CANNOT MEAN NULL. `PUT /api/recipients/[id]` and its verifier
 * twin are FULL REPLACES, and `RenameControl` — the only caller — sends back
 * name, email, relationship and role. If absent meant "clear", then correcting
 * a typo in somebody's name would silently delete the backup address that
 * exists to be used on the worst day, and nothing anywhere would report it. The
 * same trap waits for every future caller of a full-replace route.
 *
 * So it is closed structurally rather than by asking each caller to remember:
 * a body that does not mention the field cannot change it. Only an explicit
 * empty value removes one.
 *
 * The same address twice is refused rather than silently deduplicated. Accepting
 * it is the worst outcome this feature has: the owner does the work, the screen
 * shows a second address, and every "backup" copy lands in the same junk folder
 * as the first — redundancy that reads as real and is not. Refusing at the door
 * tells them while they can still supply a different mailbox.
 */
export function readSecondaryAddress(value: unknown, primary: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('a second address must be text', SECONDARY_EMAIL_FIELD);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!isEmailAddress(trimmed)) {
    throw new ValidationError('a valid second email is required', SECONDARY_EMAIL_FIELD);
  }

  if (trimmed.toLowerCase() === primary.trim().toLowerCase()) {
    throw new ValidationError(
      'the second address must be a different mailbox — the same one twice is not a backup',
      SECONDARY_EMAIL_FIELD,
    );
  }

  return trimmed;
}
