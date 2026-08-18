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

  it('keeps NEVER-DECLARED apart from DECLARED-AS-EMPTY', () => {
    /*
      The whole three-state design rests on this one distinction. `null` means
      no client ever said, and reads as `unknown`; `''` means a client said the
      blob holds nothing recognised, which is an answer. Collapse them and the
      product either keeps lying or alarms every owner at once.
    */
    expect(validateCreateInput(createBody()).secret_kinds, 'absent must stay null').toBeNull();
    expect(
      validateCreateInput(createBody({ secret_kinds: '' })).secret_kinds,
      'an explicit empty declaration must survive as empty, not become null',
    ).toBe('');
  });

  it('drops a kind it does not recognise rather than refusing the save', () => {
    // The browser is not always the same build as the server. Refusing the
    // whole save because a newer client named an unknown kind would break
    // saving in order to fix a label.
    expect(validateCreateInput(createBody({ secret_kinds: 'password,quantum_rune' })).secret_kinds).toBe(
      'password',
    );
  });

  it('what the browser sends is derived from the fields it just encrypted', () => {
    /*
      Not a style point. If the declaration were built from form state rather
      than from the encoded array, an empty TOTP box could still declare `totp`
      — and the item would read `usable` while holding no second factor, which
      is the original falsehood wearing the fix's clothes.
    */
    const src = SRC('src/app/(owner)/vault/new/NewVaultItemClient.tsx');
    expect(src, 'the new-item form does not declare secret_kinds at all').toMatch(/secret_kinds:\s*secretKindsOf\(/);
    expect(src, 'it must declare from the same array it encodes').toMatch(
      /encodeSecretPayload\(fields\)/,
    );
    // And the helper honours the same empty-field rule the encoder does.
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
  const base = { id: 'email', title: 'Primary email', criticality: 'critical', is_root_credential: false };

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
      items: [{ ...base }, { id: 'bank', title: 'Bank', criticality: 'critical', is_root_credential: false }],
      ruledItemIds: ['email', 'bank'],
      verifierCount: 1,
    });
    expect(p.reachable).toBe(2);
  });
});
