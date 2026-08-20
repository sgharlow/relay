/**
 * The address the public is told to write to.
 *
 * ONE DEFINITION, because it was three: the interest form, the privacy page and
 * the terms page each hardcoded the same string, so changing it meant changing
 * it everywhere and finding out later where you missed.
 *
 * ✅ 2026-08-09 — Cloudflare Email Routing is live and this is now a domain
 * address. It was a personal Gmail until then, deliberately: the apex had no MX,
 * so a domain address would have swallowed every customer reply rather than
 * merely looking unpolished.
 *
 * Proven at the mailbox, not at the API — a 200 from a mail provider says
 * nothing about delivery. A message sent through the app's own send path
 * (`lib/notify/email.ts`) to `hello@relaystandby.com` arrived in the **inbox**,
 * not spam. The same run re-proved outbound still works, which was not
 * guaranteed: enabling routing rewrote the APEX SPF to
 * `include:_spf.mx.cloudflare.net`, and had Resend's return-path been the apex
 * rather than the `send.` subdomain, every notification would have started
 * failing SPF the moment routing went on.
 *
 * A catch-all was enabled later the same day, so an arbitrary address at the
 * domain now reaches the inbox too. `ROUTED_ADDRESSES` is kept anyway: with a
 * catch-all, even a TYPO routes, which means a mistake here would look like it
 * worked while putting an address on four public pages that nobody monitors as
 * the contact. The list pins the address that is actually intended.
 *
 * ⚠️ When testing routing, never send from the account the rule forwards TO.
 * Gmail deduplicates by Message-ID, so a forwarded copy of a message you sent
 * is suppressed and never appears in the inbox — a working route and a broken
 * one look identical. This cost an investigation; Cloudflare emits an automated
 * notice about it. Send from an unrelated address. See
 * `docs/email-dns-runbook.md` §7.
 *
 * Feature: relay-h0-mvp
 */

/**
 * Addresses confirmed to reach a real inbox, by sending to each and reading the
 * result in the mailbox. Add to this ONLY after routing has been created in
 * Cloudflare and a real message has been seen arriving — never in anticipation.
 */
export const ROUTED_ADDRESSES = [
  'hello@relaystandby.com',
  'relay@relaystandby.com',
] as const;

/** Where a customer, or a regulator, is told to write. */
export const CONTACT_EMAIL: (typeof ROUTED_ADDRESSES)[number] = 'hello@relaystandby.com';

/** Ready-made mailto: for links. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

/**
 * The address Relay's notifications are SENT FROM — `RESEND_FROM_ADDRESS`.
 *
 * Stated here rather than read from the environment because it is now shown to
 * owners in the UI: the Microsoft-junk warning ends by asking them to add this
 * address to the contact's contacts list, and `/circle` is a client component
 * with no access to server env. Its test asserts the two agree wherever the
 * variable is present, so the copy cannot drift away from what actually sends.
 */
export const SENDER_EMAIL: (typeof ROUTED_ADDRESSES)[number] = 'relay@relaystandby.com';

/**
 * WHO OPERATES RELAY. One definition, for the same reason the address above has
 * one — it goes on the Terms, the Privacy page and the About page, and three
 * copies of a person's name is three places to get it wrong.
 *
 * 🔴 THE TERMS NAMED NOBODY UNTIL 2026-08-16. A contract a paying customer
 * enters said "Relay is early-stage software" and "provided as-is" without ever
 * saying by whom. That was survivable while the plan was paid advertising, where
 * nobody checks; it stopped being survivable when the plan became op-eds in AARP
 * and caregiver.com, because an editor needs an attributable author and a reader
 * being asked for their family's passwords needs a counterparty to judge.
 * Found by the readiness assessment: docs/product-readiness-assessment-2026-08-16.md.
 *
 * There is NO company and NO EIN — Relay is operated by an individual, ratified
 * as `relay-operator-is-an-individual`. That is stated plainly rather than
 * dressed up as a "we", and it also settles the 10DLC route: Sole Proprietor is
 * the only one available without a Tax ID.
 *
 * ⚠️ NAMING HIM IS THE POINT; HIS EMPLOYMENT IS NOT. The employer-anonymity rule
 * binds every public surface and every bio supplied to an outlet. Nothing about
 * where he works belongs on this site, in a byline, or in a pitch.
 */
export const OPERATOR_NAME = 'Steve Harlow';

/**
 * Supplied by Steve 2026-08-16 for the About page, as the credential an editor
 * checks before attributing a byline.
 *
 * ⚠️ FLAGGED WHEN IT WAS ADDED, AND THE FLAG STANDS: this connects Relay to a
 * profile that names an employer, one hop from a public page. It is here because
 * Steve provided it for this purpose knowing the anonymity rule exists, not
 * because the rule was overlooked. Removing it is deleting this constant and the
 * one link that uses it.
 */
export const OPERATOR_PROFILE_URL = 'https://www.linkedin.com/in/stevengharlow/';

/**
 * How long a person waits for an answer, and the promise the acute paths were
 * already implying without it.
 *
 * 🔴 THE FINDING (`PROJECT.yaml → deferred → support-has-an-address-and-no-commitment`,
 * C6). `hello@relaystandby.com` is offered on the paths people reach at their
 * worst — the access screen tells a recipient whose reveal failed to write in
 * *"so a person can look"* — and nothing anywhere said how long looking takes.
 * A promise of a human, made to somebody in an emergency, is either kept or it
 * should not be on that screen.
 *
 * RULED BY STEVE 2026-08-20: one business day. Chosen because it is honest for a
 * solo operator on his worst week rather than flattering on his best — a
 * commitment that is true only when nothing else is happening is the one that
 * breaks on the day it matters. It makes the acute-path copy true as written,
 * which is why that copy did not have to change.
 *
 * ⚠️ ONE DEFINITION, CONSUMED EVERYWHERE. The same rule `OPERATOR_NAME` follows:
 * a response time stated in three places is three things to keep true, and the
 * one nobody updates is the one a customer quotes back.
 */
export const SUPPORT_RESPONSE_TIME = 'within one business day';
