/**
 * The address the public is told to write to.
 *
 * ONE DEFINITION, because it was three: the interest form, the privacy page and
 * the terms page each hardcoded the same string, so changing it meant changing
 * it everywhere and finding out later where you missed.
 *
 * ⚠️ IT IS STILL A PERSONAL GMAIL, and that is deliberate rather than
 * overlooked. `relaystandby.com` has no MX record, so anything@relaystandby.com
 * can be sent FROM but not received — putting a domain address on the site
 * before mail routing exists would replace a slightly unprofessional address
 * with one that silently swallows every customer reply. Outbound auth is
 * already correct (DKIM, DMARC, and SPF on the send. subdomain); receiving is
 * the missing half.
 *
 * TO FINISH: enable Cloudflare Email Routing on the zone, forward
 * hello@relaystandby.com to the personal inbox, SEND A REAL MESSAGE AND CONFIRM
 * IT ARRIVES, then change the constant below. Verify at the mailbox, not at the
 * API — a 200 from a mail provider proves nothing about delivery.
 *
 * Feature: relay-h0-mvp
 */

/** Where a customer, or a regulator, is told to write. */
export const CONTACT_EMAIL = 'sgharlow+relay@gmail.com';

/** Ready-made mailto: for links. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
