/**
 * [A3] — readiness goes green at EXECUTABLE, not at complete.
 *
 * The pivot's strongest objection to the design it rejected was "perpetual amber
 * readiness that owners learn to ignore". Gating green on every roster row being
 * confirmed reintroduces precisely that: a circle of five with four confirmed is
 * amber forever, and a light that is always amber is a light nobody reads.
 *
 * Green means the plan CAN RUN — enough confirmed verifiers to satisfy the
 * quorum, plus at least one confirmed recipient to receive anything. Paired with
 * §4.3, that makes green a true claim about capability rather than a decoration.
 *
 * And anything short of green states the SINGLE fastest next action. A status
 * light that does not say what to do is the amber owners learn to ignore, just
 * with more colours.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { readStandbyState } from '../people/standby-state';

export interface CirclePersonState {
  id: string;
  standby_state: string | null;
}

export interface CircleAssessment {
  light: 'red' | 'amber' | 'green';
  executable: boolean;
  confirmedVerifiers: number;
  confirmedRecipients: number;
  /** The one thing to do next, or null when there is nothing. */
  nextAction: string | null;
}

function countBy(people: CirclePersonState[], state: 'claimed' | 'confirmed'): number {
  return people.filter((p) => readStandbyState(p.standby_state) === state).length;
}

export function assessCircle(input: {
  requiredConfirmations: number;
  verifiers: CirclePersonState[];
  recipients: CirclePersonState[];
}): CircleAssessment {
  const confirmedVerifiers = countBy(input.verifiers, 'confirmed');
  const confirmedRecipients = countBy(input.recipients, 'confirmed');
  const claimedVerifiers = countBy(input.verifiers, 'claimed');
  const claimedRecipients = countBy(input.recipients, 'claimed');

  const quorumMet = confirmedVerifiers >= input.requiredConfirmations;
  const executable = quorumMet && confirmedRecipients >= 1;

  const anyoneClaimed =
    confirmedVerifiers + confirmedRecipients + claimedVerifiers + claimedRecipients > 0;

  const light: CircleAssessment['light'] = executable ? 'green' : anyoneClaimed ? 'amber' : 'red';

  return {
    light,
    executable,
    confirmedVerifiers,
    confirmedRecipients,
    nextAction: executable ? null : nextAction(),
  };

  /**
   * Ordered by what unblocks execution SOONEST, not by what is missing most.
   * Confirming someone who has already claimed is a two-minute phone call;
   * chasing a claim takes days. So a pending confirmation always outranks a
   * pending claim, even when more people are unclaimed.
   */
  function nextAction(): string {
    if (!quorumMet && claimedVerifiers > 0) {
      return 'Confirm a verifier who has already claimed — a two-minute call, and it is the fastest way to make this plan work.';
    }
    if (!quorumMet) {
      return 'Send a verifier their code, or ask for fewer confirmations. Right now nobody could attest that an emergency is real.';
    }
    if (confirmedRecipients === 0 && claimedRecipients > 0) {
      return 'Confirm a recipient who has already claimed. Verifiers could agree, but nobody is set up to receive anything.';
    }
    return 'Send a recipient their code. Verifiers could agree, but nobody is set up to receive anything.';
  }
}
