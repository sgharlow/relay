/**
 * Which mailbox provider is on the other end, and what we have MEASURED about it.
 *
 * 🔴 THE ONE FACT THIS ENCODES, and the only one it is allowed to encode. Two
 * contemporaneous A/B test messages sent to a fresh outlook.com mailbox on
 * 2026-08-14 were both filed as junk at SCL 5, with flawless authentication
 * (`compauth=pass reason=100`, `BCL:0`, `ucf:0`, `jmr:0`) and four distinct
 * sending IPs across two runs. Message shape was refuted as the cause; so was
 * Reply-To before it. What is left is shared-pool and new-domain reputation,
 * which no code in this repo reaches — so the product cannot fix this, and the
 * honest response is to tell the owner while they can still act on it.
 *
 * ⚠️ THIS IS A CLAIM ABOUT MICROSOFT ONLY, NOT A RANKING OF PROVIDERS. Gmail is
 * not listed because a message sent through this app's own send path arrived in
 * a Gmail INBOX and was read there — evidence, not an assumption. Nothing else
 * has been measured, and an unmeasured provider must return `null` rather than
 * a reassurance: silence here means "we have not tested it", exactly as it does
 * in `delivery-events.ts`. Do not add a provider to this list on reputation,
 * folklore, or a vendor's own status page — only on a message read in a mailbox.
 *
 * `jmr:0` on both junked messages is why the contacts-list ask is in the copy:
 * it says no user-level rule matched, so a safe-sender entry is a lever that has
 * not been pulled rather than one that was tried and failed.
 *
 * Feature: relay-standby
 */

import { SENDER_EMAIL } from '../contact';

/** How the four Microsoft consumer brands are named to an owner, in one place. */
export const MICROSOFT_MAILBOX_LABEL = 'Outlook, Hotmail, Live or MSN';

/** The brand labels Microsoft's consumer mail runs under. */
const MICROSOFT_BRANDS = ['outlook', 'hotmail', 'live', 'msn'];

/**
 * True only when the address's domain is a Microsoft consumer mailbox.
 *
 * Matched on the DOMAIN'S SHAPE rather than by substring, because a substring
 * test fires on `outlook.com.example.net` and on a local part that merely
 * contains the word — and a warning that cries wolf is a warning nobody reads.
 * The brand must be the first label, and what follows it must look like a public
 * suffix (`com`, `co.uk`, `com.au`) rather than more of somebody else's domain.
 */
export function isMicrosoftMailbox(email: string): boolean {
  const trimmed = (email ?? '').trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return false;

  const labels = trimmed.slice(at + 1).split('.');
  if (labels.length < 2) return false;

  const [brand, ...suffix] = labels;
  if (!MICROSOFT_BRANDS.includes(brand)) return false;

  // `outlook.com`, `outlook.co.uk`, `live.com.au` — never `outlook.com.a.net`.
  return suffix.length <= 2 && suffix.every((l) => /^[a-z]{2,3}$/.test(l));
}

/**
 * What to tell the owner, in calm, about the channel they are about to rely on.
 *
 * Returns null for every provider we have not measured. Both levers the owner
 * actually holds are named, because a warning without a next action is only
 * anxiety: say it out loud instead, and get Relay onto the person's contacts.
 */
export function describeProviderRisk(params: {
  name: string;
  email: string;
  /** Defaults to the one definition in `lib/contact.ts`; injectable for tests. */
  senderEmail?: string;
}): string | null {
  if (!isMicrosoftMailbox(params.email)) return null;

  const sender = params.senderEmail ?? SENDER_EMAIL;
  return (
    `${params.name} is on ${MICROSOFT_MAILBOX_LABEL}. We have measured Relay's mail being filed ` +
    `as junk there, so an email may never be seen — it is not a reflection on them. Read ` +
    `anything that matters to them over the phone, and ask them to add ${sender} to their ` +
    `contacts, which is the one thing that reliably moves us out of their junk folder.`
  );
}
