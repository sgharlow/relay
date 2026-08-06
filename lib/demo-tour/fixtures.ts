/**
 * Read-only demo-tour fixtures — the sample data behind the public /demo page.
 *
 * This is a post-win showcase (no auth, no DB): a guided, annotated walk through
 * what an owner sees. Everything here is static sample data EXCEPT the audit
 * chain, which is computed at module load with the production hash primitives
 * (lib/audit/chain.ts, Requirement 8) so the chain shown on /demo is a real
 * SHA-256 hash chain that `verifyAuditChain` actually verifies — and that
 * provably breaks if tampered with (see fixtures.test.ts).
 *
 * No secrets: ciphertext/wrapped-key strings are inert sample bytes, present to
 * show the envelope *structure* the server stores (never plaintext).
 *
 * Feature: relay-h0-mvp (demo tour); reuses Requirements: 8.3, 8.4 primitives
 */

import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  verifyAuditChain,
  type ChainVerification,
} from '../audit/chain';

// ---------------------------------------------------------------------------
// Vault dashboard sample (importance engine output, metadata only)
// ---------------------------------------------------------------------------

export interface DemoVaultItem {
  id: string;
  name: string;
  category: string;
  /** Importance-engine score, always within [0, 1]. */
  importance: number;
  recipient: string;
  trigger: 'emergency' | 'estate';
}

export const DEMO_VAULT_ITEMS: DemoVaultItem[] = [
  {
    id: 'primary-email',
    name: 'Primary email — jordan@example.com',
    category: 'Email',
    importance: 0.97,
    recipient: 'Sam (spouse)',
    trigger: 'emergency',
  },
  {
    id: 'password-manager',
    name: 'Password manager master vault',
    category: 'Credentials',
    importance: 0.94,
    recipient: 'Sam (spouse)',
    trigger: 'emergency',
  },
  {
    id: 'checking-account',
    name: 'Checking & bill-pay account',
    category: 'Banking',
    importance: 0.88,
    recipient: 'Sam (spouse)',
    trigger: 'emergency',
  },
  {
    id: 'insurance-policies',
    name: 'Life & home insurance policies',
    category: 'Insurance',
    importance: 0.81,
    recipient: 'Alex (executor)',
    trigger: 'estate',
  },
  {
    id: 'estate-letter',
    name: 'Letter of instruction to executor',
    category: 'Instructions',
    importance: 0.78,
    recipient: 'Alex (executor)',
    trigger: 'estate',
  },
  {
    id: 'mortgage-docs',
    name: 'Mortgage & deed documents',
    category: 'Documents',
    importance: 0.66,
    recipient: 'Alex (executor)',
    trigger: 'estate',
  },
  {
    id: 'utilities',
    name: 'Utilities & household subscriptions',
    category: 'Subscriptions',
    importance: 0.41,
    recipient: 'Sam (spouse)',
    trigger: 'emergency',
  },
  {
    id: 'photo-archive',
    name: 'Family photo archive location + key',
    category: 'Documents',
    importance: 0.35,
    recipient: 'Sam (spouse)',
    trigger: 'estate',
  },
];

// ---------------------------------------------------------------------------
// Item detail — the envelope the server actually stores (structure, not secrets)
// ---------------------------------------------------------------------------

export interface DemoItemEnvelope {
  itemId: string;
  algorithm: string;
  /** Base64 AES-GCM ciphertext (inert sample bytes, truncated for display). */
  ciphertext: string;
  /** Base64 KMS-wrapped per-item data key (inert sample bytes). */
  wrappedDataKey: string;
  /** Base64 96-bit GCM IV. */
  iv: string;
  kmsKeyAlias: string;
  /** Columns the server persists — plaintext is deliberately not among them. */
  storedColumns: string[];
}

export const DEMO_ITEM_ENVELOPE: DemoItemEnvelope = {
  itemId: 'primary-email',
  algorithm: 'AES-GCM-256 (per-item data key, generated in the browser)',
  ciphertext:
    'q9XoZ0m4vGk7T2cRt8yWfBqUj3nHsA1dLxPvC6eKZrM5wYhN0iJgD4bTQXm8SoEa' +
    '7Vfl2uHcRpKAyG9jNtW1zM6dSBoLqIxUvhPrEnT3JgYwCk5m0e…',
  wrappedDataKey:
    'AQIDAHhwZk1Nb2NrS2V5Rm9yRGVtb1RvdXJPbmx5AAAAfjB8BgkqhkiG9w0BBwag' +
    'bzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQM…',
  iv: '5c2Fw1nJ9xTQb0Vd',
  kmsKeyAlias: 'alias/relay-h0-mvp',
  storedColumns: ['ciphertext', 'wrapped_data_key', 'iv', 'kms_key_id', 'metadata'],
};

// ---------------------------------------------------------------------------
// Release timeline — one verified emergency release, then the reversal
// ---------------------------------------------------------------------------

export interface DemoTimelineStep {
  state: 'ARMED' | 'PENDING' | 'GRACE' | 'RELEASED';
  at: string;
  headline: string;
  detail: string;
  cas: string;
}

export const DEMO_RELEASE_TIMELINE: DemoTimelineStep[] = [
  {
    state: 'ARMED',
    at: '2026-06-27T14:02:11Z',
    headline: 'Default-safe. Nothing is accessible.',
    detail:
      'The owner checks in on schedule; recipients hold links that resolve to nothing. ARMED is the state the system falls back to whenever anything is uncertain — including when concurrent writes exhaust their retries.',
    cas: "state = 'armed', version = 3",
  },
  {
    state: 'PENDING',
    at: '2026-06-27T14:02:36Z',
    headline: 'An emergency trigger fires.',
    detail:
      'A missed check-in (or a manual emergency) advances the machine. The transition is a strongly-consistent compare-and-set on Aurora DSQL — it succeeds exactly once, no matter how many actors race.',
    cas: "UPDATE release_state SET state='pending', version=version+1 WHERE id=$1 AND state='armed' AND version=$2",
  },
  {
    state: 'GRACE',
    at: '2026-06-27T14:02:47Z',
    headline: 'Grace window opens; verifiers are asked.',
    detail:
      'The owner is notified and can cancel with one check-in. Meanwhile N-of-M trusted verifiers independently confirm the emergency is real. No single person — not even a verifier — can force a release alone.',
    cas: "UPDATE release_state SET state='grace', grace_ends_at=$3 WHERE id=$1 AND state='pending' AND version=$2",
  },
  {
    state: 'RELEASED',
    at: '2026-06-27T14:03:12Z',
    headline: 'Scoped access opens — and stays reversible.',
    detail:
      'Recipients can now decrypt only the items they were granted. When the owner recovers and checks in, the version bump instantly invalidates every recipient token and the vault re-ARMs. Estate releases, by contrast, are permanent by design.',
    cas: "UPDATE release_state SET state='released', released_at=now() WHERE id=$1 AND state='grace' AND version=$2",
  },
];

// ---------------------------------------------------------------------------
// Audit chain — computed with the production primitives so it truly verifies
// ---------------------------------------------------------------------------

export interface DemoAuditEntry {
  seq: number;
  event_type: string;
  actor: string;
  detail: string;
  occurred_at: string;
  prev_hash: string;
  entry_hash: string;
}

interface DemoAuditEvent {
  event_type: string;
  actor: string;
  detail: string;
  occurred_at: string;
}

const DEMO_AUDIT_EVENTS: DemoAuditEvent[] = [
  {
    event_type: 'owner.signin',
    actor: 'owner',
    detail: 'TOTP sign-in from a recognized device',
    occurred_at: '2026-06-27T13:58:04Z',
  },
  {
    event_type: 'vault.item_created',
    actor: 'owner',
    detail: 'Item "Primary email" stored (ciphertext + wrapped key only)',
    occurred_at: '2026-06-27T13:59:41Z',
  },
  {
    event_type: 'rules.granted',
    actor: 'owner',
    detail: 'Sam granted "Primary email" under the emergency trigger',
    occurred_at: '2026-06-27T14:00:19Z',
  },
  {
    event_type: 'trigger.armed',
    actor: 'owner',
    detail: 'Emergency trigger armed — 2 verifiers, 1 confirmation required',
    occurred_at: '2026-06-27T14:02:11Z',
  },
  {
    event_type: 'release.pending',
    actor: 'system',
    detail: 'Missed check-in advanced ARMED → PENDING (CAS, version 3 → 4)',
    occurred_at: '2026-06-27T14:02:36Z',
  },
  {
    event_type: 'release.grace_opened',
    actor: 'system',
    detail: 'Grace window opened; owner and verifiers notified',
    occurred_at: '2026-06-27T14:02:47Z',
  },
  {
    event_type: 'verifier.confirmed',
    actor: 'verifier:alex',
    detail: 'Verifier confirmation 1 of 1 received',
    occurred_at: '2026-06-27T14:03:09Z',
  },
  {
    event_type: 'release.released',
    actor: 'system',
    detail: 'GRACE → RELEASED (CAS); recipient tokens now resolve',
    occurred_at: '2026-06-27T14:03:12Z',
  },
  {
    event_type: 'access.decrypted',
    actor: 'recipient:sam',
    detail: 'Recipient unwrapped "Primary email" via KMS (scoped token)',
    occurred_at: '2026-06-27T14:05:58Z',
  },
  {
    event_type: 'release.rearmed',
    actor: 'owner',
    detail: 'Owner check-in re-armed the vault; version bump revoked all recipient tokens',
    occurred_at: '2026-06-27T14:11:30Z',
  },
];

/** Builds the demo chain with the production hash function (pure, deterministic). */
export function buildDemoAuditChain(events: DemoAuditEvent[] = DEMO_AUDIT_EVENTS): DemoAuditEntry[] {
  const entries: DemoAuditEntry[] = [];
  let prev = GENESIS_PREV_HASH;
  events.forEach((event, i) => {
    const partial = { seq: i + 1, ...event, prev_hash: prev };
    const entry_hash = computeEntryHash(prev, partial);
    entries.push({ ...partial, entry_hash });
    prev = entry_hash;
  });
  return entries;
}

export const DEMO_AUDIT_CHAIN: DemoAuditEntry[] = buildDemoAuditChain();

/** Verified with the production verifier at module load — displayed on /demo. */
export const DEMO_CHAIN_VERIFICATION: ChainVerification = verifyAuditChain(DEMO_AUDIT_CHAIN);
