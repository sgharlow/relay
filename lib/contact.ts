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
 * ⚠️ THERE IS NO CATCH-ALL. Cloudflare routes only addresses that have been
 * explicitly created. Measured the same day: `hello@` and `relay@` arrive;
 * `support@` was accepted by Resend and then dropped in silence. Editing the
 * constant below to any address not in `ROUTED_ADDRESSES` would compile, ship,
 * render on four pages, and lose every customer email that followed it — so
 * that list is enforced by a test rather than left as a comment.
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
