/**
 * Tests for the usability rule — the fix for the falsehood at the centre of the
 * product.
 *
 * THE DEFECT. `assessPreparedness` defined *reachable* as "an access rule
 * exists", and nothing more. So an owner who stored the password for a
 * 2FA-protected account was told "Sarah could reach all 3 of the things that
 * matter." Sarah receives a password and a locked door. The sentence was the
 * one number on the screen the product asked an owner to act on, and it could
 * be false in the direction that costs the most.
 *
 * THE TRAP THIS SUITE EXISTS TO HOLD SHUT (Q1/Q3 of docs/secret-types-design.md).
 * At rollout every item has NULL for both new columns. Reading NULL as "needs
 * nothing" keeps the lie and puts machinery behind it; reading it as "needs
 * something" alarms every owner about every item and destroys the signal
 * permanently. Absent and empty are different facts and the tests below pin
 * them apart.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

import { describe, it, expect } from 'vitest';

import { itemUsability, parseFactorList, serialiseFactorList } from './usability';

/** An item with nothing declared — the state every existing row is in. */
const undeclared = { id: 'a', secret_kinds: null, factors_required: null, depends_on_item_id: null };

describe('parseFactorList', () => {
  it('reads a sorted comma-joined list', () => {
    expect(parseFactorList('sms,totp')).toEqual(['sms', 'totp']);
  });

  it('distinguishes ABSENT from EMPTY, which is the whole of Q3', () => {
    // NULL means no client has ever declared. '' means a client declared that
    // there is nothing. Collapsing them is the bug this module exists to avoid.
    expect(parseFactorList(null)).toBeNull();
    expect(parseFactorList('')).toEqual([]);
  });

  it('ignores blanks and unknown factors rather than failing the read', () => {
    // A read path that throws on unfamiliar data takes the vault down for a
    // value a future client wrote. Drop what we do not understand.
    expect(parseFactorList('totp, ,nonsense,sms')).toEqual(['sms', 'totp']);
  });

  it('round-trips through serialiseFactorList', () => {
    expect(serialiseFactorList(['totp', 'sms'])).toBe('sms,totp');
    expect(serialiseFactorList([])).toBe('');
  });
});

describe('itemUsability — the three states', () => {
  it('is UNKNOWN when the account has never been asked what it demands', () => {
    expect(itemUsability(undeclared, [])).toBe('unknown');
  });

  it('is UNKNOWN when the demand is known but what is stored is not', () => {
    // secret_kinds NULL is "no client has declared", not "the item is empty".
    // Calling this blocked would alarm an owner about an item that may be fine.
    expect(
      itemUsability({ ...undeclared, factors_required: 'totp', secret_kinds: null }, []),
    ).toBe('unknown');
  });

  it('is USABLE when the account demands nothing beyond the password', () => {
    expect(
      itemUsability({ ...undeclared, factors_required: '', secret_kinds: 'password' }, []),
    ).toBe('usable');
  });

  it('is USABLE when the stored secret covers what the account demands', () => {
    expect(
      itemUsability({ ...undeclared, factors_required: 'totp', secret_kinds: 'password,totp' }, []),
    ).toBe('usable');
  });

  it('is BLOCKED when the account demands a code that was never stored', () => {
    // The defect, stated as a test: a password for a 2FA account.
    expect(
      itemUsability({ ...undeclared, factors_required: 'totp', secret_kinds: 'password' }, []),
    ).toBe('blocked');
  });

  it('accepts recovery codes in place of the authenticator', () => {
    /*
      Not a convenience. Recovery codes are the sanctioned way into an account
      when the authenticator is gone, which is precisely the situation Relay
      exists for. Calling these items blocked would be a false alarm on the
      single most prepared thing an owner can do.
    */
    expect(
      itemUsability(
        { ...undeclared, factors_required: 'totp', secret_kinds: 'password,recovery_codes' },
        [],
      ),
    ).toBe('usable');
  });

  it('accepts stored answers for security questions', () => {
    expect(
      itemUsability(
        { ...undeclared, factors_required: 'security_questions', secret_kinds: 'security_answers' },
        [],
      ),
    ).toBe('usable');
  });
});

describe('itemUsability — factors no stored secret can ever satisfy', () => {
  it('BLOCKS a passkey account with no recovery route', () => {
    /*
      Class B of the design. A passkey is bound to a device and cannot be handed
      to anyone, so there is no field that could satisfy it and no amount of
      storing helps. The honest answer is that the recipient cannot get in —
      which is the answer, not a workaround for it.
    */
    expect(
      itemUsability(
        { ...undeclared, factors_required: 'passkey', secret_kinds: 'password,totp' },
        [],
      ),
    ).toBe('blocked');
  });

  it('BLOCKS an SMS code with no route to the phone account', () => {
    expect(
      itemUsability({ ...undeclared, factors_required: 'sms', secret_kinds: 'password' }, []),
    ).toBe('blocked');
  });

  it('accepts a passkey when a dependency leads to an account that IS usable', () => {
    // The recovery route the design prescribes: name the account that recovers
    // it. `depends_on_item_id` already models this — it is the risk graph.
    const phone = { id: 'phone', secret_kinds: 'password', factors_required: '', depends_on_item_id: null };
    const item = { id: 'a', secret_kinds: 'password', factors_required: 'passkey', depends_on_item_id: 'phone' };
    expect(itemUsability(item, [phone])).toBe('usable');
  });

  it('does NOT accept a dependency that is itself blocked', () => {
    // A chain is only as good as its end. Following it into another locked door
    // and reporting success would be the same lie one level down.
    const phone = { id: 'phone', secret_kinds: 'password', factors_required: 'passkey', depends_on_item_id: null };
    const item = { id: 'a', secret_kinds: 'password', factors_required: 'sms', depends_on_item_id: 'phone' };
    expect(itemUsability(item, [phone])).toBe('blocked');
  });

  it('is UNKNOWN when the dependency has never been declared', () => {
    const phone = { id: 'phone', secret_kinds: null, factors_required: null, depends_on_item_id: null };
    const item = { id: 'a', secret_kinds: 'password', factors_required: 'sms', depends_on_item_id: 'phone' };
    expect(itemUsability(item, [phone])).toBe('unknown');
  });

  it('survives a dependency cycle instead of hanging', () => {
    /*
      `depends_on_item_id` is app-enforced, not a foreign key — 001 says so in
      its own comment — so nothing in the database prevents a cycle. A recursive
      walk without a guard would take out every screen that renders the vault.
    */
    const a = { id: 'a', secret_kinds: 'password', factors_required: 'sms', depends_on_item_id: 'b' };
    const b = { id: 'b', secret_kinds: 'password', factors_required: 'sms', depends_on_item_id: 'a' };
    expect(itemUsability(a, [a, b])).toBe('blocked');
  });

  it('survives a dependency pointing at an item that is not there', () => {
    const item = { id: 'a', secret_kinds: 'password', factors_required: 'sms', depends_on_item_id: 'gone' };
    expect(itemUsability(item, [])).toBe('blocked');
  });
});
