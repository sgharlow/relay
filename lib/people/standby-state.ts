/**
 * Person state — where a named contact is between "the owner typed their name"
 * and "they can actually do their job".
 *
 * REPLACES A DEAD COLUMN. `verification_status` was declared NOT NULL DEFAULT
 * 'pending' in migration 001, had no CHECK constraint, was read with a
 * `?? 'pending'` fallback, was written by NOTHING, and rendered as a permanent
 * chip in the circle UI. A status that can never change is furniture.
 *
 * SINGLE WRITER — DO NOT WRAP THIS IN THE RELEASE MACHINE. `ReleaseStateMachine`
 * exists because three writers race for a release row: the owner, the verifiers
 * and the scheduler. Person state has exactly one writer, the owner, so a plain
 * guarded UPDATE is correct and honest. Extracting a generic `CasStateMachine<S>`
 * to share between them would add ceremony to this and dilute the reason the
 * other one is careful. (docs/standby-architecture.md §4.2)
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

export const STANDBY_STATES = ['invited', 'claimed', 'confirmed', 'revoked'] as const;
export type StandbyState = (typeof STANDBY_STATES)[number];

/**
 * NULL reads as `invited`, which is what lets migration 020 add the column
 * without a backfill — the same trick `case_id` used in 008.
 *
 * Anything unrecognised also reads as `invited`, deliberately. A row is never
 * more trusted than its data, so unreadable state resolves to the LEAST
 * privileged value; a corrupt column must never be able to present someone as
 * confirmed.
 */
export function readStandbyState(raw: unknown): StandbyState {
  return (STANDBY_STATES as readonly unknown[]).includes(raw) ? (raw as StandbyState) : 'invited';
}

/**
 * The permitted edges.
 *
 * `confirmed -> claimed` is the one that is easy to miss: re-claiming binds a new
 * `claimed_user_id`, which changes the derived fingerprint phrase, so the owner's
 * earlier confirmation is no longer about the person now holding the slot. It has
 * to drop back to amber rather than silently stand.
 *
 * `revoked` is terminal. Re-including someone is a new invitation, not an
 * un-revoke — so a withdrawn person can never be quietly restored by a bad
 * update.
 */
export const PERMITTED_STANDBY_EDGES: readonly { from: StandbyState; to: StandbyState }[] = [
  { from: 'invited', to: 'claimed' },
  { from: 'invited', to: 'revoked' },
  { from: 'claimed', to: 'confirmed' },
  { from: 'claimed', to: 'revoked' },
  { from: 'confirmed', to: 'claimed' }, // identity behind the confirmation changed
  { from: 'confirmed', to: 'revoked' },
];

export function canTransitionStandby(from: StandbyState, to: StandbyState): boolean {
  return PERMITTED_STANDBY_EDGES.some((e) => e.from === from && e.to === to);
}

/**
 * `unreachable` is DERIVED, never stored and never swept.
 *
 * An invited person whose ticket TTL has passed is unreachable by definition —
 * the ticket that would have let them claim is dead. Storing that would mean a
 * second scheduled thing that can silently stop, and one scheduler ledger is
 * already carried. Compute it when someone looks.
 *
 * A missing or unparseable expiry is NOT unreachable: bad data must not be able
 * to mark a real contact as lost.
 */
export function isUnreachable(
  person: { state: StandbyState; inviteExpiresAt: string | null },
  now: Date = new Date(),
): boolean {
  if (person.state !== 'invited') return false;
  if (!person.inviteExpiresAt) return false;
  const expiry = new Date(person.inviteExpiresAt).getTime();
  if (Number.isNaN(expiry)) return false;
  return expiry <= now.getTime();
}

export type CircleLight = 'red' | 'amber' | 'green';

/**
 * Three positions, not four states and not six.
 *
 * Green is a claim about CAPABILITY, not about paperwork: it means this person
 * has bound an identity and the owner has verified out of band that it is really
 * them. Everything short of that is a person who may not be able to act when it
 * matters, and the owner deserves to see that as one glance rather than a status
 * vocabulary they have to learn.
 */
export function circleLight(state: StandbyState): CircleLight {
  if (state === 'confirmed') return 'green';
  if (state === 'claimed') return 'amber';
  return 'red'; // invited or revoked — either way, cannot act
}
