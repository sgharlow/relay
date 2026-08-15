/**
 * A second address for the people whose silence stops a release.
 *
 * WHY REDUNDANCY RATHER THAN A BETTER CHANNEL. Two content hypotheses for the
 * Outlook junk-filing were tested and refuted on 2026-08-09 and 2026-08-14
 * (Reply-To, then message shape); what remains is shared-pool and new-domain
 * sending reputation, which no code in this repo reaches. When you cannot make
 * one channel reliable, the cheap honest move is to stop depending on exactly
 * one — and `email_secondary` has been sitting in migration 020 on BOTH roster
 * tables since the standby pivot, written and read by nothing.
 *
 * 🔴 THE INVARIANT, and the reason this is a function rather than a `[a, b]`
 * literal at each send site: A MESSAGE THAT CARRIES A CREDENTIAL IS NEVER SENT
 * TWICE. Core principle 1 is that nothing secret is transmitted at release time,
 * and the product has spent real design effort getting codes OUT of messages
 * (adaptive minting, the claimed-recipient branch, bare links). Fanning a code
 * out to a second mailbox would buy reachability with exactly the property Relay
 * sells, and it would do it invisibly — every send site would still read like
 * one send.
 *
 * So the two halves are deliberately asymmetric:
 *   carries a credential   one address. Reachability is somebody else's problem
 *                          — the owner reads it down the phone (§3.3), which is
 *                          both more reliable and better identity evidence.
 *   carries no credential  both addresses. A "someone started a release, go and
 *                          sign in" notice is worth nothing to an interceptor,
 *                          so a second copy costs nothing but a send.
 *
 * TWO IS ALSO THE CEILING. `lib/ops/outbound-mail-bounds.test.ts` holds the
 * property that every path an authenticated caller can push mail down is
 * bounded; this doubles that volume, which is a bounded, stated multiplier
 * rather than an open one. A third channel needs its own budget conversation.
 *
 * ⚠️ THIS DOES NOT TOUCH THE INVITATION PATH, and that is not an oversight. An
 * invitation carries a claim code — a credential by this file's definition — so
 * it is single-address by the rule above, and `reserveInviteEmail` therefore
 * still meters exactly one send per invitation. The invite budget did not have
 * to move because the credential rule already keeps it honest.
 *
 * Feature: relay-standby
 */

/** Same shape as the roster validators use; deliberately not a second regex. */
import { isEmailAddress } from '../validation';

export function addressesFor(params: {
  primary: string;
  secondary: string | null | undefined;
  /** True for anything containing a code, a token, or a sign-in link. */
  carriesCredential: boolean;
}): string[] {
  const primary = params.primary.trim();
  if (params.carriesCredential) return [primary];

  const secondary = (params.secondary ?? '').trim();
  if (!secondary || !isEmailAddress(secondary)) return [primary];

  // The same mailbox written two ways is one mailbox. Sending twice would look
  // like redundancy on the screen and be a duplicate in the inbox.
  if (secondary.toLowerCase() === primary.toLowerCase()) return [primary];

  return [primary, secondary];
}
