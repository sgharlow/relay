/**
 * Verifier decisions: confirm, deny, abstain.
 *
 * `/api/triggers/[id]/confirm` had no deny path. A verifier who KNEW a request
 * was illegitimate could only decline to act — indistinguishable from being on
 * a plane. That is a correctness defect in the mechanism the product positions
 * as its moat, not a UX shortfall.
 *
 * `received_confirmations` still counts ONLY confirmations, so the existing
 * N-of-M semantics are untouched. Denials are counted separately and halt the
 * release when they make the threshold arithmetically unreachable (J7-R7).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R5, J7-R7, J7-R8, J7-R9, J7-R10
 */

export const DECISIONS = ['confirm', 'deny', 'abstain'] as const;

export type Decision = (typeof DECISIONS)[number];

/**
 * With M verifiers needing N confirmations, `denials` objections leave at most
 * `M - denials` possible confirmations. Unreachable once that drops below N.
 */
export function thresholdUnreachable(m: number, n: number, denials: number): boolean {
  return m - denials < n;
}

export interface OutcomeInput {
  m: number;
  n: number;
  confirmations: number;
  denials: number;
}

/**
 * A threshold already met is NOT undone by a late denial — the release was
 * legitimately authorised at the moment the quorum landed, and retracting it
 * would make the outcome depend on message ordering.
 */
export function evaluateOutcome(input: OutcomeInput): 'advance' | 'halt' | 'wait' {
  if (input.confirmations >= input.n) return 'advance';
  if (thresholdUnreachable(input.m, input.n, input.denials)) return 'halt';
  return 'wait';
}
