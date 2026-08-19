/**
 * Recording what an ACCOUNT demands at the door.
 *
 * One definition, because there are now two places an owner can answer the
 * question: the control on the vault row, and the prompt in the readiness
 * banner that finally ASKS it rather than waiting to be found. Two hand-written
 * fetches to the same endpoint would drift, and the values here are ones where
 * drift is silent — see the test on `[]` versus `null`.
 *
 * ⚠️ THREE STATES, AND `null` IS NOT A NEUTRAL DEFAULT.
 *   `['totp']` — the owner says the account asks for a code as well.
 *   `[]`       — the owner says a password is enough. An ANSWER; makes the item usable.
 *   `null`     — nobody has said. Withdraws the answer and returns the item to unasked.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

/** The factors an owner can currently be asked about — see the one-factor note in `usability.ts`. */
export type DeclarableFactor = 'totp';

export async function setFactorsRequired(
  itemId: string,
  value: DeclarableFactor[] | null,
): Promise<void> {
  const res = await fetch(`/api/vault/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ factors_required: value }),
  });
  if (!res.ok) throw new Error('Could not save that.');
}
