/**
 * Tests for the read that refuses to guess.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { selected } from './row';

describe('selected', () => {
  it('returns the value when the column was selected and has one', () => {
    expect(selected<string>({ secret_kinds: 'password,totp' }, 'secret_kinds')).toBe('password,totp');
  });

  it('returns null when the column was selected and is SQL NULL', () => {
    // A real answer: the row exists, the column is empty. Nothing is wrong.
    expect(selected<string>({ secret_kinds: null }, 'secret_kinds')).toBeNull();
  });

  it('keeps an empty string, which is a different answer from null', () => {
    /*
      `''` means a client declared that the blob holds nothing recognised;
      `null` means no client has ever declared. usability.ts turns on exactly
      that distinction, so this helper must not collapse it.
    */
    expect(selected<string>({ secret_kinds: '' }, 'secret_kinds')).toBe('');
  });

  it('THROWS when the column was never selected, rather than reporting null', () => {
    /*
      🔴 THE WHOLE POINT. `pg` returns exactly the columns a query asked for, so
      an absent KEY means the projection did not include it — a fact about the
      code — while a null VALUE means the owner has not answered — a fact about
      the person. Collapsing them is how a forgotten column becomes a sentence
      about the user: on 2026-08-18 a dropped projection rendered as "nobody has
      checked whether 2 of them need a code as well".
    */
    expect(() => selected<string>({ id: 'x' }, 'secret_kinds')).toThrow(/not selected/i);
  });

  it('names the column and the reader in the message, so the fix is obvious', () => {
    expect(() => selected<string>({ id: 'x' }, 'factors_required')).toThrow(/factors_required/);
  });

  it('treats an explicit undefined as never-selected, because that is what it is', () => {
    // A hand-built projection that spread a partial row: the key exists, the
    // value is undefined. It carries no more information than absence does.
    expect(() => selected<string>({ secret_kinds: undefined }, 'secret_kinds')).toThrow(/not selected/i);
  });
});
