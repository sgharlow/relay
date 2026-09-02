/**
 * Is this contact address an alias of the owner's own mailbox?
 *
 * WHY THIS EXISTS (2026-09-01). The live owner's entire circle turned out to be
 * plus-aliases of his own address, created for testing — and nothing anywhere
 * said so. `normaliseEmail` (lib/people/people.ts) only trims and lowercases,
 * so §3.7 rule 5's promise that "the same human under two spellings never
 * counts as their own independent cover" holds for case variants and NOT for
 * `steve+ben@…` — and rule 7's no-self-verifier guard does not exist at all.
 * Had the owner claimed his alias's code, the quorum would have read GREEN
 * with the owner vouching for his own emergency: a dead-man's switch whose
 * verifier is the dead man.
 *
 * WHAT COUNTS AS AN ALIAS HERE. Same domain and same local-part after
 * stripping a `+suffix` — the sub-addressing every major provider supports —
 * plus, on Gmail's domains only, dot-insensitivity (`s.harlow` ≡ `sharlow`),
 * because Gmail defines dots as ignorable and this owner is on Gmail. The
 * exact same address is trivially an alias of itself.
 *
 * WHAT THIS IS NOT. Not a refusal — an owner may legitimately hold a test
 * alias in the roster on purpose. It is a VISIBILITY guarantee: every surface
 * that renders quorum health must be able to say "this cover is not
 * independent" (§3.7 rules 5 and 7). Refusing at claim time is a separate,
 * unruled decision.
 *
 * Feature: relay-standby
 * Requirements: docs/standby-architecture.md §3.7 rules 5 and 7
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function canonical(email: string): { local: string; domain: string } | null {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at <= 0) return null;
  const domain = email.trim().toLowerCase().slice(at + 1);
  let local = email.trim().toLowerCase().slice(0, at);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, '');
  if (!local || !domain) return null;
  return { local, domain };
}

/** True when `contactEmail` reaches the same mailbox as `ownerEmail`. */
export function isOwnerAlias(ownerEmail: string, contactEmail: string): boolean {
  const o = canonical(ownerEmail);
  const c = canonical(contactEmail);
  if (!o || !c) return false;
  return o.domain === c.domain && o.local === c.local;
}

/** The sentence every quorum surface prints beside an aliased contact. */
export const OWNER_ALIAS_WARNING =
  'address is an alias of the OWNER — counts toward quorum but is NOT independent cover ' +
  '(§3.7 rules 5/7): a quorum met only by owner aliases is self-signed';
