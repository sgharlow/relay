/**
 * The public contact address, pinned.
 *
 * This address is on the landing page, the interest form, the privacy policy
 * and the Terms — it is where a customer, or a regulator, is told to write. Two
 * ways it can silently stop working, both of which have a test below.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { CONTACT_EMAIL, CONTACT_MAILTO, ROUTED_ADDRESSES, SENDER_EMAIL } from './contact';

describe('the public contact address', () => {
  it('is on the product domain, not a personal mailbox', () => {
    // It was sgharlow+relay@gmail.com until Cloudflare Email Routing existed —
    // deliberately, because an unroutable domain address swallows mail whereas
    // an unpolished personal one delivers it. Now that routing exists, dropping
    // back to a personal address would be a regression, not a stopgap.
    expect(CONTACT_EMAIL).toMatch(/@relaystandby\.com$/);
  });

  it('is an address that actually routes', () => {
    // relaystandby.com has NO CATCH-ALL. Verified 2026-08-09 by sending to a
    // real address and an invented one: hello@ and relay@ arrived in the inbox,
    // support@ was accepted by Resend and then silently dropped, because
    // Cloudflare only routes addresses that have been explicitly created.
    //
    // So a plausible-looking edit here — info@, support@, hi@ — would compile,
    // ship, render correctly on four pages, and lose every customer email that
    // followed it. Nothing else in the system would notice.
    expect(ROUTED_ADDRESSES).toContain(CONTACT_EMAIL);
  });

  it('produces a usable mailto link', () => {
    expect(CONTACT_MAILTO).toBe(`mailto:${CONTACT_EMAIL}`);
  });
});

/**
 * The FROM address is now shown to owners, in the "add us to your contacts" ask
 * that the Microsoft-junk warning ends with. A safe-sender entry for the wrong
 * address is worse than none: the owner does the work, believes the channel is
 * fixed, and nothing changed.
 */
describe('the sending address owners are told to allow', () => {
  it('is an address that actually routes', () => {
    expect(ROUTED_ADDRESSES).toContain(SENDER_EMAIL);
  });

  it('matches what the app actually sends from, wherever that is configured', () => {
    const configured = process.env.RESEND_FROM_ADDRESS?.trim();
    // Absent in a bare test environment; asserted wherever it is present, which
    // includes any run that loads .env.local and the deployed environment.
    if (!configured) return;
    expect(SENDER_EMAIL).toBe(configured.toLowerCase());
  });
});
