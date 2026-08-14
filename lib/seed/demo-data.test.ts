/**
 * Tests for lib/seed/demo-data.ts
 *
 * Validates: Requirements 11.1, 7.4 (demo dataset invariants)
 */

import { describe, it, expect } from 'vitest';
import { buildDemoData } from './demo-data';
import { USER_SELECTABLE_TRIGGER_TYPES } from '../domain/enums';

const data = buildDemoData();
const byKey = new Map(data.vaultItems.map((i) => [i.key, i]));

describe('demo dataset', () => {
  it('has a demo user and exactly 25 vault items across ≥4 categories', () => {
    expect(data.user.is_demo_account).toBe(true);
    expect(data.vaultItems).toHaveLength(25);
    const categories = new Set(data.vaultItems.map((i) => i.category));
    for (const c of ['finance', 'communication', 'government', 'health']) {
      expect(categories.has(c as never)).toBe(true);
    }
  });

  it('marks exactly Gmail and 1Password as root credentials', () => {
    const roots = data.vaultItems.filter((i) => i.is_root_credential).map((i) => i.key).sort();
    expect(roots).toEqual(['gmail', 'onepassword']);
  });

  it('wires bank → gmail dependency edges for the risk-graph reveal', () => {
    for (const k of ['chase', 'bofa', 'fidelity']) {
      expect(byKey.get(k)?.dependsOnKey).toBe('gmail');
    }
  });

  it('keeps every importance_score within [0, 1]', () => {
    for (const i of data.vaultItems) {
      expect(i.importance_score).toBeGreaterThanOrEqual(0);
      expect(i.importance_score).toBeLessThanOrEqual(1);
    }
  });

  it('has unique item keys and every dependsOnKey points at a real item', () => {
    expect(new Set(data.vaultItems.map((i) => i.key)).size).toBe(25);
    for (const i of data.vaultItems) {
      if (i.dependsOnKey) expect(byKey.has(i.dependsOnKey)).toBe(true);
    }
  });

  it('has 2 recipients, 2 verifiers, and rules referencing valid keys', () => {
    expect(data.recipients).toHaveLength(2);
    expect(data.verifiers).toHaveLength(2);
    const recipientKeys = new Set(data.recipients.map((r) => r.key));
    for (const rule of data.rules) {
      expect(byKey.has(rule.vaultItemKey)).toBe(true);
      expect(recipientKeys.has(rule.recipientKey)).toBe(true);
    }
  });

  /*
    🔴 THE SEED IS ALSO THE SCREENSHOT SOURCE. Every figure in
    public/guide/index.html and docs/use-cases.html is captured from this account,
    so a trigger seeded here becomes a picture in the documentation. Until
    2026-08-12 the seed carried an Estate trigger and an irreversible estate
    rule — a capability excluded from USER_SELECTABLE_TRIGGER_TYPES, and
    withdrawn permanently on 2026-08-14 when `g2-counsel-opinion` was declined,
    which /terms also says.

    The same contradiction was closed in /rules and then again in the public
    tour; this was the third copy. Asserting it here means the fourth cannot
    appear silently, and the narrowed types on SeedRule/SeedReleaseState mean it
    cannot compile either.
  */
  it('seeds only triggers an owner is actually allowed to choose', () => {
    for (const rule of data.rules) {
      expect(USER_SELECTABLE_TRIGGER_TYPES).toContain(rule.trigger_type);
    }
    for (const rs of data.releaseStates) {
      expect(USER_SELECTABLE_TRIGGER_TYPES).toContain(rs.trigger_type);
    }
  });

  it('leaves every seeded rule reversible, as everything on offer is', () => {
    for (const rule of data.rules) expect(rule.reversible).toBe(true);
  });

  it('provisions an ARMED emergency release_state', () => {
    const triggers = data.releaseStates.map((r) => r.trigger_type);
    expect(triggers).toContain('emergency');
    for (const rs of data.releaseStates) expect(rs.required_confirmations).toBeGreaterThanOrEqual(1);
  });
});

describe('the demo is a WORKING example, not a broken one', () => {
  it('seeds enough confirmed verifiers for every trigger it configures', () => {
    // The defect this pins, live on 2026-08-12: quorum tightened to `confirmed`
    // and the seed left every contact at `invited`, so BOTH demo triggers became
    // unsatisfiable and the account rendered the fatal readiness banner — on the
    // one account used to show people what the product does.
    //
    // Guards the forward direction too: raising a trigger's threshold, or
    // dropping a verifier to `claimed`, now fails here instead of quietly
    // producing a demo of a plan that cannot run.
    const data = buildDemoData();
    const confirmedVerifiers = data.verifiers.filter((v) => v.standby === 'confirmed').length;

    for (const rs of data.releaseStates) {
      expect(
        rs.required_confirmations,
        `${rs.trigger_type} needs ${rs.required_confirmations} confirmations but the seed ` +
          `confirms ${confirmedVerifiers} verifiers`,
      ).toBeLessThanOrEqual(confirmedVerifiers);
    }
  });

  it('seeds at least one confirmed recipient, so [A3] can go green', () => {
    // §4.5: executable means N confirmed verifiers AND somebody able to receive.
    const data = buildDemoData();
    expect(data.recipients.some((r) => r.standby === 'confirmed')).toBe(true);
  });

  it('leaves one contact unconfirmed, so the demo also shows the amber light', () => {
    // An all-green circle hides the control that gets you there. Deliberate, and
    // asserted so a later "tidy-up" does not silently remove the demonstration.
    const data = buildDemoData();
    const people = [...data.recipients, ...data.verifiers];
    expect(people.some((p) => p.standby === 'claimed')).toBe(true);
  });
});

/**
 * 🔴 EVERY SEEDED CONTACT WAS UNDELIVERABLE, and the seed ships to production.
 *
 * Found 2026-08-13 by asking what the hourly cron would do to `demo@relay.test`
 * on its 30-day interval: arm both triggers, then mail the owner and both
 * verifiers — at `@example.com` and `@relay.test`, domains reserved by RFC 2606
 * and RFC 6761 so that they can never receive mail. Three hard bounces, on the
 * Resend account shared with report-bridge, with nobody watching.
 *
 * The sweep exclusion in lib/release/heartbeat.ts stops the unattended send; this
 * stops the addresses being undeliverable in the first place. Two layers, because
 * the seed is also run by hand.
 */
describe('a seeded contact can actually receive mail', () => {
  const RESERVED = /@(?:example\.(?:com|org|net)|(?:.*\.)?(?:test|invalid|localhost|example))$/i;

  const data = buildDemoData();
  const contacts = [
    ...data.recipients.map((r) => ({ who: `recipient ${r.key}`, email: r.email })),
    ...data.verifiers.map((v) => ({ who: `verifier ${v.key}`, email: v.email })),
  ];

  it('names contacts at all, so this guard has something to check', () => {
    expect(contacts.length).toBeGreaterThan(2);
  });

  it('never seeds a contact in a domain that cannot receive mail', () => {
    const undeliverable = contacts.filter((c) => RESERVED.test(c.email));
    expect(
      undeliverable.map((c) => `${c.who}: ${c.email}`),
      'a seeded address in a reserved domain hard-bounces on a SHARED sender',
    ).toEqual([]);
  });

  /*
    The owner's address is exempt and stays `demo@relay.test`: it is the account
    identity `auth_sub` is derived from, not a channel. Asserted rather than
    merely skipped, so the exemption is a decision somebody can find.
  */
  it('keeps the demo owner as an identifier, not a mailbox', () => {
    expect(data.user.email).toBe('demo@relay.test');
  });
});
