/**
 * Demo seed dataset (Requirement 11.1, 7.4 — demo moment 4).
 *
 * A pure builder so the dataset's invariants are testable without a DB. The
 * runner (`db/seeds/demo-seed.ts`) inserts this, resolving the string `key`s to
 * generated UUIDs and wiring `dependsOnKey` → `depends_on_item_id` edges (the
 * risk-graph reveal: bank accounts gate on the root email).
 *
 * Importance scores are set here directly rather than via the Intake Agent
 * (task 25) — note: when the Intake Agent ships, re-running it over the seed
 * would recompute these. Seed ciphertext is a placeholder (not real envelope
 * encryption), so seeded items are not decryptable — the demo exercises the
 * metadata-driven views (vault dashboard, triage plan, risk graph) and the
 * release flow, not seed-item decryption.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1, 7.4
 */

import type { UserSelectableTriggerType } from '../domain/enums';

export type VaultCategory =
  | 'finance'
  | 'communication'
  | 'government'
  | 'health'
  | 'professional'
  | 'personal';

export interface SeedVaultItem {
  key: string;
  type: 'login' | 'account' | 'document' | 'note' | 'instruction';
  title: string;
  service_name: string;
  url: string | null;
  category: VaultCategory;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  is_root_credential: boolean;
  recurring_billing: boolean;
  irreplaceable: boolean;
  importance_score: number;
  dependsOnKey: string | null;
  backup_note: string | null;
}

/**
 * Seeded person state. `revoked` is deliberately absent: a demo of a removed
 * contact is a demo of nothing working, and the seed exists to show the product
 * in a state somebody could actually be shown.
 */
export type SeedStandbyState = 'invited' | 'claimed' | 'confirmed';

export interface SeedRecipient {
  key: string;
  name: string;
  relationship: string;
  email: string;
  phone: string | null;
  role: 'recipient' | 'executor' | 'caregiver' | 'partner';
  /** Person state to seed. Omitted means `invited`, as before. */
  standby?: SeedStandbyState;
}

export interface SeedVerifier {
  key: string;
  name: string;
  email: string;
  phone: string | null;
  /** Person state to seed. Omitted means `invited`, as before. */
  standby?: SeedStandbyState;
  /**
   * Issue them an emergency code as part of the seed.
   *
   * Not decoration: with both verifiers confirmed and the second trigger
   * needing both, the quorum has no slack, so [A3] correctly raised `fragile_quorum` —
   * the plan rested on two people who had no way back in if they lost a phone.
   * A demo should show a plan that is actually resilient, and giving verifiers a
   * code is exactly what the product asks a diligent owner to do.
   */
  breakGlass?: boolean;
}

export interface SeedRule {
  vaultItemKey: string;
  recipientKey: string;
  /** Selectable triggers only — see the retarget note beside `attorney` below. */
  trigger_type: UserSelectableTriggerType;
  scope: 'view' | 'act';
  reversible: boolean;
}

export interface SeedReleaseState {
  /** Selectable triggers only — see the retarget note beside `attorney` below. */
  trigger_type: UserSelectableTriggerType;
  required_confirmations: number;
}

export interface DemoData {
  user: { email: string; displayName: string; is_demo_account: boolean; checkin_interval_days: number };
  vaultItems: SeedVaultItem[];
  recipients: SeedRecipient[];
  verifiers: SeedVerifier[];
  rules: SeedRule[];
  releaseStates: SeedReleaseState[];
}

// Concise factory to keep the 25-item list readable.
function item(
  key: string,
  title: string,
  service_name: string,
  url: string | null,
  category: VaultCategory,
  criticality: SeedVaultItem['criticality'],
  importance_score: number,
  extra: Partial<SeedVaultItem> = {},
): SeedVaultItem {
  return {
    key,
    type: extra.type ?? 'login',
    title,
    service_name,
    url,
    category,
    criticality,
    is_root_credential: extra.is_root_credential ?? false,
    recurring_billing: extra.recurring_billing ?? false,
    irreplaceable: extra.irreplaceable ?? false,
    importance_score,
    dependsOnKey: extra.dependsOnKey ?? null,
    backup_note: extra.backup_note ?? null,
  };
}

/**
 * A seeded contact's address — deliverable, and inspectable.
 *
 * 🔴 THE SEEDED CONTACTS WERE ALL @example.com UNTIL 2026-08-13, and the seeded
 * account lives in PRODUCTION. `example.com` is reserved by RFC 2606 precisely
 * so it can never receive mail, so every message the product sent one of these
 * people was a guaranteed HARD BOUNCE — on the Resend account SHARED with
 * report-bridge, where the sender-reputation cost lands on a different project.
 *
 * This is the same defect the third QA sweep found on 2026-08-12 and fixed for
 * the walk fixtures (`@relay.invalid` → `sgharlow+relayqa-*@gmail.com`). The
 * SEED was never changed, and the seed is the copy that ships.
 *
 * Sub-addressing keeps them one real, monitorable inbox while remaining
 * distinguishable per person, so a demo send can actually be read afterwards
 * rather than merely not bouncing. `DEMO_CONTACT_INBOX` overrides the base for
 * anyone running the seed against their own mailbox.
 *
 * ⚠️ THE OWNER'S OWN ADDRESS STAYS `demo@relay.test`, deliberately. That string
 * is the account's IDENTITY — `auth_sub` is derived from it — so changing it
 * would not rename the production account, it would seed a second one beside the
 * first. `.test` is reserved too, but it is an identifier here rather than a
 * channel: with seeded accounts excluded from the heartbeat sweep and no
 * credential able to sign in, nothing addresses mail to the demo owner.
 */
export function demoAddress(person: string): string {
  const base = process.env.DEMO_CONTACT_INBOX ?? 'sgharlow@gmail.com';
  const [local, domain] = base.split('@');
  return `${local}+relaydemo-${person}@${domain}`;
}

/** Builds the deterministic demo dataset (25 vault items + people + rules). */
export function buildDemoData(): DemoData {
  const vaultItems: SeedVaultItem[] = [
    // Communication (5) — Gmail is the root credential that gates everything.
    item('gmail', 'Gmail', 'Google', 'https://mail.google.com', 'communication', 'critical', 0.98, {
      is_root_credential: true,
      backup_note: 'Recovery email + 2FA seed gate most account resets.',
    }),
    item('outlook', 'Outlook', 'Microsoft', 'https://outlook.com', 'communication', 'medium', 0.45),
    item('slack', 'Slack', 'Slack', 'https://slack.com', 'communication', 'low', 0.3),
    item('whatsapp', 'WhatsApp', 'Meta', 'https://whatsapp.com', 'communication', 'low', 0.28),
    item('zoom', 'Zoom', 'Zoom', 'https://zoom.us', 'communication', 'low', 0.25, { recurring_billing: true }),

    // Finance (8) — banks depend on the root email for password resets.
    item('chase', 'Chase Bank', 'Chase', 'https://chase.com', 'finance', 'critical', 0.9, { dependsOnKey: 'gmail' }),
    item('bofa', 'Bank of America', 'Bank of America', 'https://bankofamerica.com', 'finance', 'high', 0.85, { dependsOnKey: 'gmail' }),
    item('fidelity', 'Fidelity', 'Fidelity', 'https://fidelity.com', 'finance', 'high', 0.84, { dependsOnKey: 'gmail' }),
    item('vanguard', 'Vanguard', 'Vanguard', 'https://vanguard.com', 'finance', 'high', 0.82),
    item('paypal', 'PayPal', 'PayPal', 'https://paypal.com', 'finance', 'medium', 0.6, { recurring_billing: true }),
    item('venmo', 'Venmo', 'Venmo', 'https://venmo.com', 'finance', 'medium', 0.5),
    item('amex', 'American Express', 'American Express', 'https://americanexpress.com', 'finance', 'high', 0.7, { recurring_billing: true }),
    item('coinbase', 'Coinbase', 'Coinbase', 'https://coinbase.com', 'finance', 'critical', 0.88, { irreplaceable: true, backup_note: 'Seed phrase in safe — irreplaceable if lost.' }),

    // Government (4)
    item('irs', 'IRS Account', 'IRS', 'https://irs.gov', 'government', 'high', 0.72),
    item('ssa', 'Social Security', 'SSA', 'https://ssa.gov', 'government', 'high', 0.75),
    item('dmv', 'DMV', 'State DMV', 'https://dmv.org', 'government', 'low', 0.3),
    item('passport', 'Passport', 'US State Dept', null, 'government', 'high', 0.78, { type: 'document', irreplaceable: true }),

    // Health (4)
    item('mychart', 'MyChart', 'Epic MyChart', 'https://mychart.com', 'health', 'high', 0.68),
    item('cvs', 'CVS Pharmacy', 'CVS', 'https://cvs.com', 'health', 'medium', 0.5),
    item('anthem', 'Anthem Insurance', 'Anthem', 'https://anthem.com', 'health', 'high', 0.66),
    item('genome', '23andMe', '23andMe', 'https://23andme.com', 'health', 'low', 0.35, { irreplaceable: true }),

    // Professional / personal (4) — 1Password is the second root credential.
    item('onepassword', '1Password', '1Password', 'https://1password.com', 'personal', 'critical', 0.97, {
      is_root_credential: true,
      backup_note: 'Master vault — emergency kit in the fireproof box.',
    }),
    item('github', 'GitHub', 'GitHub', 'https://github.com', 'professional', 'medium', 0.55),
    item('linkedin', 'LinkedIn', 'LinkedIn', 'https://linkedin.com', 'professional', 'low', 0.3),
    item('aws', 'AWS Console', 'Amazon Web Services', 'https://aws.amazon.com', 'professional', 'high', 0.7),
  ];

  /*
    PERSON STATE, added 2026-08-12. Quorum now counts only `confirmed` people, so
    a demo seeded entirely at `invited` is a demo of a plan that cannot run — the
    fatal readiness banner, on the account used to show people the product.

    The mix is chosen, not uniform. Both verifiers are confirmed because the
    second trigger needs two, and one recipient is left CLAIMED so the circle
    shows an amber light next to the green ones: the demo then displays both the
    working end state and the control that gets you there, which an all-green
    circle would hide.
  */
  const recipients: SeedRecipient[] = [
    // Recipient inbox for the demo. Defaults to a deliverable sub-addressed inbox
    // (see demoAddress); set DEMO_RECIPIENT_EMAIL to a different one before
    // reseeding to capture the on-camera access-link delivery (see
    // demo-out/RECORDING-PLAN.md).
    { key: 'spouse', name: 'Jordan Rivera', relationship: 'Spouse', email: process.env.DEMO_RECIPIENT_EMAIL ?? demoAddress('jordan'), phone: '+15551112222', role: 'partner', standby: 'confirmed' },
    /*
      🔴 RETARGETED OFF ESTATE 2026-08-12, for the same reason the public tour
      was: `estate` is excluded from USER_SELECTABLE_TRIGGER_TYPES, and as of
      2026-08-14 permanently — `g2-counsel-opinion` was declined, not met — while
      /terms says Relay does not offer estate or inheritance services.

      This seed is not only the demo account — it is the account every
      screenshot in public/guide/index.html and docs/use-cases.html is taken
      from. Leaving an Estate trigger here put a figure captioned with a
      capability the surrounding text says is unavailable, which is a worse
      contradiction than the one already fixed in /rules and /demo because a
      screenshot looks like evidence.
    */
    { key: 'attorney', name: 'Pat Morgan', relationship: 'Sister', email: demoAddress('pat'), phone: '+15553334444', role: 'caregiver', standby: 'claimed' },
  ];

  const verifiers: SeedVerifier[] = [
    { key: 'doctor', name: 'Dr. Alex Chen', email: demoAddress('achen'), phone: '+15555556666', standby: 'confirmed', breakGlass: true },
    { key: 'brother', name: 'Sam Rivera', email: demoAddress('sam'), phone: '+15557778888', standby: 'confirmed', breakGlass: true },
  ];

  // Emergency access (reversible) to the spouse for the critical items.
  //
  // 🔴 THIS COMMENT WAS FALSE UNTIL 2026-08-12: `coinbase` is `critical` and was
  // not in this list, so the demo's standing statement read "could reach 3 of
  // the 4 things that matter" in amber on every screen. A demo whose own
  // top-line claim is amber is demonstrating an unfinished plan, and the gap was
  // an oversight rather than a point being made — the seed's ability to show an
  // uncovered critical item is exercised properly by an owner mid-setup, not by
  // shipping the demo permanently short of its own comment.
  const rules: SeedRule[] = [
    { vaultItemKey: 'gmail', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    { vaultItemKey: 'onepassword', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    { vaultItemKey: 'chase', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    { vaultItemKey: 'coinbase', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    // A second, differently-scoped condition: the person handling day-to-day
    // care reaches the identity document, and only under that trigger. Still
    // reversible, because everything the product currently offers is.
    { vaultItemKey: 'passport', recipientKey: 'attorney', trigger_type: 'caregiver', scope: 'view', reversible: true },
  ];

  const releaseStates: SeedReleaseState[] = [
    { trigger_type: 'emergency', required_confirmations: 1 },
    { trigger_type: 'caregiver', required_confirmations: 2 },
  ];

  return {
    /**
     * 🔴 `displayName` ADDED 2026-08-12. The demo owner had none, so every
     * contact standing by for them saw `demo@relay.test` on their dashboard and
     * in every message — the exact defect the standby label fix closed the same
     * day, sitting unnoticed in the one account most people will ever look at.
     */
    user: {
      email: 'demo@relay.test',
      displayName: 'Margaret Chen',
      is_demo_account: true,
      checkin_interval_days: 30,
    },
    vaultItems,
    recipients,
    verifiers,
    rules,
    releaseStates,
  };
}
