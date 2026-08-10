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
