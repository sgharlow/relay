/**
 * Proposed starting policies, derived from importance-engine output.
 *
 * The owner should edit a draft, not author from an empty state — the engine
 * already knows which items are root credentials and which are critical-finance
 * (J4-R2).
 *
 * Deterministic and metadata-only: no LLM call, so proposals are reproducible,
 * testable, and cannot leak a secret into a prompt (CC2).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2
 */

import { selectMatching, type PolicyItem, type PolicyPredicate } from './policy-predicate';

export interface ProposedPolicy {
  recipientId: string;
  triggerType: string;
  scope: 'view' | 'act';
  reversible: boolean;
  predicate: PolicyPredicate;
  rationale: string;
  itemCount: number;
}

export interface ProposalRecipient {
  id: string;
  name: string;
  role: string;
}

const TEMPLATES: { predicate: PolicyPredicate; scope: 'view' | 'act'; rationale: string }[] = [
  {
    predicate: { isRootCredential: true },
    scope: 'act',
    rationale:
      'Root credentials are the reset path for everything else. Without them, nothing else can be recovered.',
  },
  {
    predicate: { categories: ['finance', 'health'], criticalities: ['critical'] },
    scope: 'view',
    rationale: 'Critical money and health accounts are what a caregiver reaches for first.',
  },
  {
    predicate: { categories: ['utilities'] },
    scope: 'act',
    rationale: 'Utilities need action, not just visibility — the bills keep arriving.',
  },
];

/**
 * Proposals target the caregiver when one is designated, since that is the
 * person the wedge is built around; otherwise the first recipient.
 *
 * Only emergency, only reversible: an estate policy is permanent and must be a
 * deliberate act by the owner, never something the system suggested (J4-R7).
 */
export function proposePolicies(
  items: PolicyItem[],
  recipients: ProposalRecipient[],
): ProposedPolicy[] {
  const primary = recipients.find((r) => r.role === 'caregiver') ?? recipients[0];
  if (!primary) return [];

  return TEMPLATES.map((t) => ({
    recipientId: primary.id,
    triggerType: 'emergency',
    scope: t.scope,
    reversible: true,
    predicate: t.predicate,
    rationale: t.rationale,
    itemCount: selectMatching(items, t.predicate).length,
  })).filter((p) => p.itemCount > 0);
}
