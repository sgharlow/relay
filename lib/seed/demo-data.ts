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

export interface SeedRecipient {
  key: string;
  name: string;
  relationship: string;
  email: string;
  phone: string | null;
  role: 'recipient' | 'executor' | 'caregiver' | 'partner';
}

export interface SeedVerifier {
  key: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface SeedRule {
  vaultItemKey: string;
  recipientKey: string;
  trigger_type: 'emergency' | 'travel' | 'caregiver' | 'business' | 'estate';
  scope: 'view' | 'act';
  reversible: boolean;
}

export interface SeedReleaseState {
  trigger_type: 'emergency' | 'travel' | 'caregiver' | 'business' | 'estate';
  required_confirmations: number;
}

export interface DemoData {
  user: { email: string; is_demo_account: boolean; checkin_interval_days: number };
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

  const recipients: SeedRecipient[] = [
    { key: 'spouse', name: 'Jordan Rivera', relationship: 'Spouse', email: 'jordan@example.com', phone: '+15551112222', role: 'partner' },
    { key: 'attorney', name: 'Pat Morgan', relationship: 'Estate attorney', email: 'pat@example.com', phone: '+15553334444', role: 'executor' },
  ];

  const verifiers: SeedVerifier[] = [
    { key: 'doctor', name: 'Dr. Alex Chen', email: 'achen@example.com', phone: '+15555556666' },
    { key: 'brother', name: 'Sam Rivera', email: 'sam@example.com', phone: '+15557778888' },
  ];

  // Emergency access (reversible) to the spouse for the critical items.
  const rules: SeedRule[] = [
    { vaultItemKey: 'gmail', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    { vaultItemKey: 'onepassword', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    { vaultItemKey: 'chase', recipientKey: 'spouse', trigger_type: 'emergency', scope: 'view', reversible: true },
    // Permanent estate handoff to the executor (irreversible).
    { vaultItemKey: 'passport', recipientKey: 'attorney', trigger_type: 'estate', scope: 'view', reversible: false },
  ];

  const releaseStates: SeedReleaseState[] = [
    { trigger_type: 'emergency', required_confirmations: 1 },
    { trigger_type: 'estate', required_confirmations: 2 },
  ];

  return {
    user: { email: 'demo@relay.test', is_demo_account: true, checkin_interval_days: 30 },
    vaultItems,
    recipients,
    verifiers,
    rules,
    releaseStates,
  };
}
