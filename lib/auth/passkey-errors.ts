/**
 * What a failed passkey ceremony actually means.
 *
 * The WebAuthn API signals three very different situations through one throw,
 * and telling them apart is the whole job:
 *
 *   InvalidStateError — this device is ALREADY enrolled. The server sent
 *                       `excludeCredentials` and the authenticator refused to
 *                       double-enrol. The user is protected; nothing is wrong.
 *   NotAllowedError   — the prompt was dismissed, or it timed out. A decision.
 *   AbortError        — the ceremony was cancelled programmatically. Also fine.
 *   anything else     — a real failure worth telling someone about.
 *
 * This lived inline in the account page and got the first case wrong, showing
 * "Your device could not complete that." to someone who was already set up.
 * Alarming, and the opposite of the truth. Two surfaces now share it — the
 * owner account page and the standby dashboard — so the classification is
 * stated once rather than re-derived per component.
 *
 * Pure and DOM-free on purpose: the hook that uses it cannot be unit-tested
 * under `environment: 'node'`, and the taxonomy is the part that carries risk.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

export type PasskeyFailure =
  /** Already enrolled on this device — reassure, do not alarm. */
  | 'already'
  /** Dismissed or timed out — say nothing at all. */
  | 'cancelled'
  /** Something genuinely went wrong. */
  | 'failed';

export function classifyPasskeyError(err: unknown): PasskeyFailure {
  // DOMException carries the meaning in `name`; a plain Error will not match
  // and correctly falls through to 'failed'.
  const name = (err as { name?: unknown } | null | undefined)?.name;
  if (typeof name !== 'string') return 'failed';

  if (name === 'InvalidStateError') return 'already';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  return 'failed';
}
