/**
 * The two columns migration 035 added are actually WIRED — written by a client,
 * returned by a read, and consumed by the sentence that depends on them.
 *
 * 🔴 WHY A WIRING TEST AND NOT ONLY BEHAVIOUR TESTS. `usability.ts` and
 * `preparedness.ts` were written, tested and merged on 2026-08-17 against these
 * columns, and were completely inert: no SELECT returned the columns, no client
 * wrote them, so every item read `unknown` and the rule never fired. Every unit
 * test passed throughout. That is this repo's most-repeated defect shape — a
 * guard living in a helper nothing calls — and `lib/ops/` exists because of it.
 *
 * So this file asserts the PATH, not the rule: the rule already has
 * `usability.test.ts`. The distinction matters because the path is what broke.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13 (migration 035, secret types Phase 1)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { validateCreateInput } from './vault-items';
import { assessPreparedness } from './preparedness';
import { secretKindsOf } from '../crypto/secret-payload';

const SRC = (f: string) => readFileSync(f, 'utf8');

/** A create body that passes every other rule, so only the field under test varies. */
const createBody = (over: Record<string, unknown> = {}) => ({
  type: 'login',
  title: 'Fastmail',
  ciphertext: 'AAAA',
  wrapped_data_key: 'AAAA',
  kms_key_id: 'arn:aws:kms:us-east-1:1:key/abc',
  ...over,
});

describe('the write path — a client can declare what the blob holds', () => {
  it('accepts a declaration and stores it sorted, so one value has one spelling', () => {
    expect(validateCreateInput(createBody({ secret_kinds: 'totp,password' })).secret_kinds).toBe(
      'password,totp',
    );
  });

  it('REFUSES a write that carries no declaration — fail closed at the boundary', () => {
    /*
      🔴 THE OTHER HALF OF THE PHASE-1 FIX. Deriving at the choke point makes the
      value right for every write that passes through it; this makes a write that
      SKIPS it fail loudly instead of silently persisting null. A hand-rolled
      fetch, an old client, or a future path that forgot all arrive here without
      the field, and all are refused. Before this, three of five write paths
      skipped the declaration and the worst of them (update) left a STALE one
      standing over a re-encrypted blob.
    */
    expect(() => validateCreateInput(createBody()), 'absent must be rejected').toThrow(
      /secret_kinds is required/,
    );
    expect(
      () => validateCreateInput(createBody({ secret_kinds: null })),
      'null is not a legal input on a new write — only historical rows are null',
    ).toThrow(/secret_kinds is required/);
  });

  it('keeps DECLARED-AS-EMPTY distinct from a value — the answer survives', () => {
    /*
      The three-state distinction (never-declared / declared-empty / declared-
      value) still matters, but never-declared is no longer reachable by a WRITE
      — it is the state of pre-035 historical rows only, and usability.test.ts
      pins how the DATA layer reads it. At the write boundary the live
      distinction is empty vs value: `''` means "holds nothing recognised", an
      answer, and must not be confused with a populated declaration.
    */
    expect(validateCreateInput(createBody({ secret_kinds: '' })).secret_kinds).toBe('');
    expect(validateCreateInput(createBody({ secret_kinds: 'totp,password' })).secret_kinds).toBe(
      'password,totp',
    );
  });

  it('drops a kind it does not recognise rather than refusing the save', () => {
    // Absence is refused (above); an unknown KIND is dropped. Different policies
    // for different problems: the browser may be a newer build than the server,
    // so breaking every save to fix a label would be its own outage. An empty
    // result after dropping is still a valid declaration, not an absent one.
    expect(validateCreateInput(createBody({ secret_kinds: 'password,quantum_rune' })).secret_kinds).toBe(
      'password',
    );
  });

  it('the declaration is derived at the CHOKE POINT, not at any call site', () => {
    /*
      🔴 THIS TEST REPLACES ONE THAT GREPPED `NewVaultItemClient` FOR
      `secret_kinds: secretKindsOf(...)`. That call-site derivation was the
      Phase-1 shape and it was the bug: it lived on ONE of five write paths, so
      the other four wrote nothing. The fix moved the derivation into the single
      function that produces ciphertext — `encryptForUpload` — from the plaintext
      it is about to encrypt, so every path gets it for free and no call site can
      forget or disagree. So the assertion inverts: the derivation must be at the
      choke point, and the call site must NOT pass it.
    */
    const service = SRC('lib/crypto/crypto-service.ts');
    expect(
      service,
      'encryptForUpload must derive secret_kinds from the plaintext it encrypts',
    ).toMatch(/secret_kinds\s*=\s*secretKindsOf\(decodeSecretPayload\(plaintext\)\)/);

    const form = SRC('src/app/(owner)/vault/new/NewVaultItemClient.tsx');
    expect(
      /secret_kinds:/.test(form),
      'the new-item form passes secret_kinds — it must not; a caller value is ignored and would be a second definition',
    ).toBe(false);

    // The derivation honours the same empty-field rule the encoder does: an
    // untouched TOTP box declares no `totp`, which is what keeps a code-less
    // blob from reading `usable` on a code it does not hold.
    expect(secretKindsOf([{ kind: 'password', value: 'x' }, { kind: 'totp', value: '' }])).toBe(
      'password',
    );
  });
});

describe('the read path — a read returns what a write stored', () => {
  it('both columns are in the metadata projection', () => {
    /*
      The projection is one string shared by every read. Asserting on it is what
      catches the failure that actually happened: the columns existed in the
      table and in the type, and no query asked for them.
    */
    const src = SRC('lib/vault/vault-items.ts');
    const projection = /const METADATA_COLUMNS =([\s\S]*?);/.exec(src)?.[1] ?? '';
    expect(projection, 'secret_kinds is not selected, so every read returns undefined').toContain(
      'secret_kinds',
    );
    expect(projection, 'factors_required is not selected').toContain('factors_required');
  });

  it('the dashboard projection carries them to the screen that must show them', () => {
    const src = SRC('lib/vault/dashboard-view.ts');
    expect(src).toMatch(/secret_kinds\?:/);
    expect(src).toMatch(/factors_required\?:/);
  });
});

describe('the acceptance criterion — the sentence stops overstating', () => {
  const base = {
    id: 'email',
    title: 'Primary email',
    criticality: 'critical',
    is_root_credential: false,
    // Required since 2026-08-18 — see the note on PreparednessInput.
    depends_on_item_id: null,
  };

  it('an account declared to need a code, holding only a password, is NOT reachable', () => {
    const p = assessPreparedness({
      items: [{ ...base, factors_required: 'totp', secret_kinds: 'username,password' }],
      ruledItemIds: ['email'],
      verifierCount: 1,
    });
    expect(p.reachable, 'the recipient meets a locked door; the count must say so').toBe(0);
    expect(p.mattering).toBe(1);
  });

  it('the same account is reachable once the second factor is stored', () => {
    const p = assessPreparedness({
      items: [{ ...base, factors_required: 'totp', secret_kinds: 'username,password,totp' }],
      ruledItemIds: ['email'],
      verifierCount: 1,
    });
    expect(p.reachable).toBe(1);
  });

  it('recovery codes count — they are the sanctioned way in when the authenticator is gone', () => {
    const p = assessPreparedness({
      items: [{ ...base, factors_required: 'totp', secret_kinds: 'password,recovery_codes' }],
      ruledItemIds: ['email'],
      verifierCount: 1,
    });
    expect(p.reachable).toBe(1);
  });

  it('an owner who answered "a password is enough" is believed', () => {
    const p = assessPreparedness({
      items: [{ ...base, factors_required: '', secret_kinds: 'password' }],
      ruledItemIds: ['email'],
      verifierCount: 1,
    });
    expect(p.reachable).toBe(1);
  });

  it('AN UNDECLARED VAULT IS LEFT EXACTLY AS IT WAS — the rollout invariant', () => {
    /*
      Every item in every existing vault has both columns NULL, through no act
      of the owner's. If that state changed the sentence, every owner would be
      told on the same afternoon that their finished plan is unfinished, over a
      measurement they were never offered. The design names that false alarm as
      the way this signal is destroyed permanently rather than temporarily.
    */
    const p = assessPreparedness({
      items: [
        { ...base, secret_kinds: null, factors_required: null },
        {
          id: 'bank',
          title: 'Bank',
          criticality: 'critical',
          is_root_credential: false,
          secret_kinds: null,
          factors_required: null,
          depends_on_item_id: null,
        },
      ],
      ruledItemIds: ['email', 'bank'],
      verifierCount: 1,
    });
    expect(p.reachable).toBe(2);
  });
});
