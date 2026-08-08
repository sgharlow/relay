/**
 * Invisible bot signals for the public lead form.
 *
 * WHY NOT A CAPTCHA. This form exists to measure whether caregivers will convert
 * at $119/yr. A visible challenge is friction applied to the exact behaviour
 * being measured, so it does not merely cost leads — it biases the gate the ad
 * spend is buying. Anything added here has to be invisible to a real person.
 *
 * The honeypot (in the route) catches bots that fill every field. This catches
 * the other common shape: bots that fill fields correctly but submit far faster
 * than a human can read a label and type an address.
 *
 * FAIL-OPEN ON ABSENCE, deliberately. A missing timestamp is treated as
 * plausible rather than as a bot, because the failure modes are wildly
 * asymmetric: silently discarding real leads because a client-side field
 * stopped populating is exactly the invisible-breakage scenario the dual-record
 * design exists to prevent, whereas a little spam is merely annoying. Never
 * make an anti-spam heuristic capable of silently dropping genuine demand.
 *
 * Feature: relay-g1-wtp
 */

/**
 * Below this, a submission is not a person. Reading the label, tapping the
 * field, waiting for the keyboard and typing an address does not happen in
 * under two and a half seconds — even with autofill, which still requires a tap
 * and a selection.
 */
export const MIN_HUMAN_FILL_MS = 2_500;

/**
 * Above this, the timestamp is stale enough to be meaningless (a tab left open
 * overnight, or a forged value). Not treated as a bot — just not as evidence.
 */
export const MAX_PLAUSIBLE_AGE_MS = 12 * 60 * 60 * 1000;

export type SpeedVerdict = 'too-fast' | 'plausible' | 'unknown';

/**
 * Judges how long the visitor had the form open.
 *
 * `renderedAt` is a client clock reading, so it is advisory: a determined bot
 * can send anything. It is not a security control and must not gate anything
 * that matters — it is a cheap filter for unsophisticated, high-volume spam.
 */
export function submissionSpeedVerdict(renderedAt: unknown, now: number = Date.now()): SpeedVerdict {
  // Coerce narrowly and explicitly. A blanket Number() is fail-CLOSED here:
  // Number([1700000000000]) is 1700000000000, because a single-element array
  // stringifies to its element — so a JSON body sending an array would have
  // been judged an instant submission and silently discarded. Only a real
  // number, or a string of nothing but digits, is evidence of anything.
  const t =
    typeof renderedAt === 'number'
      ? renderedAt
      : typeof renderedAt === 'string' && /^\d+$/.test(renderedAt.trim())
        ? Number(renderedAt.trim())
        : NaN;
  if (!Number.isFinite(t) || t <= 0) return 'unknown';

  const elapsed = now - t;

  // A future timestamp means a skewed clock or a forged value. Neither is
  // evidence of a human, and neither is proof of a bot.
  if (elapsed < 0) return 'unknown';
  if (elapsed > MAX_PLAUSIBLE_AGE_MS) return 'unknown';

  return elapsed < MIN_HUMAN_FILL_MS ? 'too-fast' : 'plausible';
}
