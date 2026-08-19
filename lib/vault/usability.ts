/**
 * Can a recipient actually get in?
 *
 * THE FALSEHOOD THIS REPLACES. `assessPreparedness` defined *reachable* as "an
 * access rule exists" and nothing more, so an owner storing the password for a
 * 2FA-protected account was told "Sarah could reach all 3 of the things that
 * matter." Sarah receives a password and a locked door. That sentence is the
 * one number the product asks an owner to act on, and it was wrong in the
 * direction that costs the most — a plan that looks finished is not revisited.
 *
 * THE RULE, from docs/secret-types-design.md §4.2:
 *
 *     usable(item) = factors_required ⊆ ( secret_kinds ∪ reachable-through-dependencies )
 *
 * THREE STATES, NOT TWO, AND THAT IS THE DESIGN'S BLOCKING DECISION (Q1/Q3).
 * At rollout both columns are NULL for every item in every vault. Read NULL as
 * "demands nothing" and the product keeps lying with machinery behind it; read
 * it as "demands something" and every owner is alarmed about every item,
 * including the many logins that genuinely have no second factor — and a false
 * alarm at that scale destroys the signal permanently. So `unknown` is a first-
 * class answer: it converts a silent falsehood into a question the owner can
 * answer in one tap.
 *
 * ⚠️ ABSENT IS NOT EMPTY. `null` means no client has ever declared; `''` means a
 * client declared that there is nothing. Every function here keeps them apart,
 * and `parseFactorList` is tested on exactly that distinction.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

import { SECRET_KINDS } from '../crypto/secret-payload';

/**
 * What an ACCOUNT can demand at the door — distinct from `SECRET_KINDS`, which
 * is what an ITEM holds. The two vocabularies overlap (`totp` appears in both)
 * and are deliberately not merged: one is a demand, the other is a possession,
 * and the whole point of this module is that having one does not imply the
 * other.
 */
export const REQUIRABLE_FACTORS = [
  'totp',
  'sms',
  'email',
  'passkey',
  'hardware_key',
  'security_questions',
] as const;

export type RequirableFactor = (typeof REQUIRABLE_FACTORS)[number];

/**
 * Which stored secrets satisfy which demands.
 *
 * The empty lists are the honest part. A passkey or a hardware key is bound to
 * a device and an SMS code arrives on a phone — nothing an owner can type into
 * a vault satisfies those, so they are satisfiable ONLY through a recovery
 * route (`depends_on_item_id`, the risk graph the product already models).
 *
 * `recovery_codes` satisfying `totp` is not a convenience. Recovery codes are
 * the sanctioned way into an account when the authenticator is gone, which is
 * precisely the situation Relay exists for; refusing them would raise a false
 * alarm on the most prepared thing an owner can do.
 */
const SATISFIED_BY: Record<RequirableFactor, readonly string[]> = {
  totp: ['totp', 'recovery_codes'],
  security_questions: ['security_answers'],
  sms: [],
  email: [],
  passkey: [],
  hardware_key: [],
};

/** The columns this rule reads. Everything else about an item is irrelevant here. */
export interface UsabilityItem {
  id: string;
  /** What the BLOB holds, client-declared. `null` = never declared. */
  secret_kinds: string | null;
  /** What the ACCOUNT demands, owner-declared. `null` = never asked. */
  factors_required: string | null;
  /** The recovery route: the item this one is recovered through. */
  depends_on_item_id: string | null;
}

export type Usability = 'usable' | 'blocked' | 'unknown';

/**
 * Parses a stored TEXT list, keeping absent distinct from empty.
 *
 * Unrecognised entries are dropped rather than thrown on. A read path that
 * fails on an unfamiliar value would take every vault screen down the day a
 * newer client writes a factor this build has not heard of — and this column is
 * written by the browser, which is not always the same version as the server.
 */
function parseList(value: string | null | undefined, allowed: readonly string[]): string[] | null {
  if (value === null || value === undefined) return null;
  const known = new Set(allowed);
  return [...new Set(value.split(',').map((s) => s.trim()).filter((s) => known.has(s)))].sort();
}

/** What the account demands. `null` when nobody has ever said. */
export function parseFactorList(value: string | null | undefined): RequirableFactor[] | null {
  return parseList(value, REQUIRABLE_FACTORS) as RequirableFactor[] | null;
}

/** What the item holds. `null` when no client has ever declared. */
export function parseKindList(value: string | null | undefined): string[] | null {
  return parseList(value, SECRET_KINDS);
}

/** The stored form: sorted and comma-joined, so one value has one spelling. */
export function serialiseFactorList(factors: readonly string[]): string {
  return [...new Set(factors)].sort().join(',');
}

/**
 * Can a recipient get into this item?
 *
 * `all` supplies the items a dependency edge can point at. It is passed rather
 * than fetched so this stays a pure function over a page of rows the caller has
 * already loaded — no query per item on a screen rendering ninety of them.
 */
export function itemUsability(
  item: UsabilityItem,
  all: readonly UsabilityItem[],
  visiting: ReadonlySet<string> = new Set(),
): Usability {
  const required = parseFactorList(item.factors_required);
  if (required === null) return 'unknown'; // nobody has asked what this account demands
  if (required.length === 0) return 'usable'; // the owner said: nothing beyond the secret

  const kinds = parseKindList(item.secret_kinds);
  if (kinds === null) return 'unknown'; // the demand is known; what is stored is not

  let sawUnknown = false;

  for (const factor of required) {
    if (SATISFIED_BY[factor].some((k) => kinds.includes(k))) continue;

    // Nothing stored covers it, so the only way in is the recovery route.
    const route = routeUsability(item, all, visiting);
    if (route === 'usable') continue;
    // A door known to be locked outranks one nobody has checked: report the
    // certainty, not the doubt.
    if (route === 'blocked') return 'blocked';
    sawUnknown = true;
  }

  return sawUnknown ? 'unknown' : 'usable';
}

/**
 * WHY an item reads `unknown` — three causes with three different remedies.
 *
 * 🔴 THE COUNT THAT HID THE DIFFERENCE. `assessPreparedness` had one number for
 * every unknown item, and the two common causes are not the same problem:
 *
 *   `unasked`     — nobody has said what the account demands. One tap answers it.
 *   `undeclared`  — the owner HAS said it demands a code, and no client ever
 *                   declared what the entry holds. Every item created before
 *                   2026-08-18 is here, and NO tap can fix it: the server cannot
 *                   read ciphertext, so only the owner re-saving the item through
 *                   the browser records what it holds.
 *   `unresolved`  — both are known, and the route it recovers through is itself
 *                   unknown. The remedy is on that other item, which is prompted
 *                   on its own row.
 *
 * Only meaningful for an item `itemUsability` has already called `unknown`; the
 * order of the checks mirrors that function's own, so the two cannot disagree.
 */
export type UnknownCause = 'unasked' | 'undeclared' | 'unresolved';

export function unknownCause(item: UsabilityItem): UnknownCause {
  if (parseFactorList(item.factors_required) === null) return 'unasked';
  if (parseKindList(item.secret_kinds) === null) return 'undeclared';
  return 'unresolved';
}

/**
 * Follows `depends_on_item_id` to whatever recovers this item.
 *
 * ⚠️ CYCLE-GUARDED, and not defensively. That column is app-enforced, not a
 * foreign key — `001_initial.sql` says so in its own comment — so nothing in
 * the database stops `a → b → a`. An unguarded walk would hang every screen
 * that renders a vault, which is a worse outage than the bug being fixed.
 */
function routeUsability(
  item: UsabilityItem,
  all: readonly UsabilityItem[],
  visiting: ReadonlySet<string>,
): Usability {
  if (!item.depends_on_item_id) return 'blocked'; // no route named
  if (visiting.has(item.depends_on_item_id)) return 'blocked'; // a cycle recovers nothing

  const next = all.find((i) => i.id === item.depends_on_item_id);
  if (!next) return 'blocked'; // the route points at something that is not there

  return itemUsability(next, all, new Set([...visiting, item.id]));
}
