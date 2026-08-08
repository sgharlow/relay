/**
 * Role-concentration detector — a safety requirement, not a UX suggestion.
 *
 * One adult child holding delegate + sole recipient + sole verifier can grant
 * themselves access and confirm their own trigger with nobody else involved.
 * That is the precise structure that enables undetectable elder financial
 * abuse, and it is the product's principal harm vector (J3-R10).
 *
 * An independent party on EITHER axis breaks it: a second recipient means the
 * access is visible to someone else, and a second verifier means the trigger
 * cannot be self-confirmed.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R10
 */

import { normaliseEmail } from './people';

export interface CirclePerson {
  email: string;
  isDelegate: boolean;
  isRecipient: boolean;
  isVerifier: boolean;
}

export interface ConcentrationWarning {
  email: string;
  severity: 'high';
  message: string;
  remedy: string;
}

export function detectRoleConcentration(people: CirclePerson[]): ConcentrationWarning | null {
  const concentrated = people.find((p) => p.isDelegate && p.isRecipient && p.isVerifier);
  if (!concentrated) return null;

  // Normalised, so the same human under two spellings never counts as their
  // own independent cover.
  const key = normaliseEmail(concentrated.email);

  const otherRecipients = people.filter(
    (p) => p.isRecipient && normaliseEmail(p.email) !== key,
  );
  const otherVerifiers = people.filter(
    (p) => p.isVerifier && normaliseEmail(p.email) !== key,
  );

  if (otherRecipients.length > 0 || otherVerifiers.length > 0) return null;

  return {
    email: concentrated.email,
    severity: 'high',
    message:
      'One person is currently the helper, the only recipient, and the only verifier. ' +
      'That means nobody else would ever be asked before access opens.',
    remedy: 'Add one more verifier — a neighbour, a second sibling, or a family friend.',
  };
}
