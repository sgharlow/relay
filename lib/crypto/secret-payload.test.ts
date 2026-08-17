/**
 * The plaintext contract, and the three eras it has to read forever.
 *
 * 🔴 THE DEFECT THIS EXISTS FOR WAS LIVE. Two incompatible plaintext formats
 * were already in production — the CSV import wrote `{"username":…,"password":…}`
 * while the manual form wrote a bare string — and the recipient view rendered
 * whatever it decrypted into a `<pre>`. Recipients of imported items were shown
 * raw JSON.
 *
 * ⚠️ THE LEGACY SHAPES CAN NEVER BE RETIRED. The server cannot read plaintext,
 * so it cannot re-encrypt a single row; no migration will ever normalise these.
 * A test that stopped covering shape 2 or shape 3 would be describing a cleanup
 * that is not possible.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import {
  encodeSecretPayload,
  decodeSecretPayload,
  recoveryCodesOf,
  valueOf,
  secretKindsOf,
  type SecretField,
} from './secret-payload';

describe('shape 1 — the current format', () => {
  it('round-trips every kind', () => {
    const fields: SecretField[] = [
      { kind: 'username', value: 'steve@example.com' },
      { kind: 'password', value: 'hunter2' },
      { kind: 'totp', value: 'otpauth://totp/Google:steve?secret=JBSWY3DPEHPK3PXP' },
      { kind: 'recovery_codes', value: '8f2k-91mz\nqq31-77bd' },
      { kind: 'note', value: 'Use the work profile.', label: 'Which profile' },
    ];
    expect(decodeSecretPayload(encodeSecretPayload(fields))).toEqual(fields);
  });

  it('is a stable, inspectable envelope', () => {
    // Golden: the exact bytes that get encrypted. A change here is a change to a
    // format that no migration can ever fix up, so it should be deliberate.
    expect(encodeSecretPayload([{ kind: 'password', value: 'hunter2' }])).toBe(
      '{"relay":1,"fields":[{"kind":"password","value":"hunter2"}]}',
    );
  });

  it('drops empty fields rather than storing them', () => {
    // A password of '' would render as a blank labelled row and read as "the
    // password is empty" rather than "there isn't one".
    const encoded = encodeSecretPayload([
      { kind: 'username', value: 'steve' },
      { kind: 'password', value: '   ' },
      { kind: 'totp', value: '' },
    ]);
    expect(decodeSecretPayload(encoded)).toEqual([{ kind: 'username', value: 'steve' }]);
  });

  it('ignores a field whose kind it does not recognise', () => {
    // Forward compatibility: an item written by a newer client must still open
    // in an older one, showing what it can rather than nothing.
    const payload = '{"relay":1,"fields":[{"kind":"password","value":"x"},{"kind":"hologram","value":"y"}]}';
    expect(decodeSecretPayload(payload)).toEqual([{ kind: 'password', value: 'x' }]);
  });
});

describe('shape 2 — the legacy CSV-import format', () => {
  it('reads the JSON that recipients were being shown raw', () => {
    const legacy = JSON.stringify({ username: 'steve@example.com', password: 'hunter2' });
    expect(decodeSecretPayload(legacy)).toEqual([
      { kind: 'username', value: 'steve@example.com' },
      { kind: 'password', value: 'hunter2' },
    ]);
  });

  it('handles the null username the CSV parser permits', () => {
    // ParsedRow.username is `string | null`, so this shape genuinely occurs.
    expect(decodeSecretPayload(JSON.stringify({ username: null, password: 'hunter2' }))).toEqual([
      { kind: 'password', value: 'hunter2' },
    ]);
  });
});

describe('shape 3 — a bare secret, how every hand-added item was written', () => {
  it('treats a plain string as the password', () => {
    expect(decodeSecretPayload('correct horse battery staple')).toEqual([
      { kind: 'password', value: 'correct horse battery staple' },
    ]);
  });

  it('does not lose a password that happens to be valid JSON', () => {
    /*
      A password of "42", "true" or "[1,2]" parses cleanly and is still just a
      password. Any of these reaching the JSON branch and being discarded would
      lose the one thing the item exists to hold.
    */
    for (const raw of ['42', 'true', 'null', '[1,2,3]', '"quoted"']) {
      expect(decodeSecretPayload(raw)).toEqual([{ kind: 'password', value: raw }]);
    }
  });

  it('falls back to the raw text for an object it cannot interpret', () => {
    // Ugly, and still strictly better than showing nothing to somebody trying to
    // get in. This branch used to be the ONLY behaviour.
    const odd = '{"some":"other shape"}';
    expect(decodeSecretPayload(odd)).toEqual([{ kind: 'password', value: odd }]);
  });

  it('never throws, whatever it is handed', () => {
    // This runs at the moment a family is trying to open an account. An
    // exception here is a blank screen with no way forward.
    for (const input of ['', '{', '{"relay":1}', '{"relay":2,"fields":[]}', '{"relay":1,"fields":"no"}']) {
      expect(() => decodeSecretPayload(input)).not.toThrow();
    }
    expect(decodeSecretPayload('')).toEqual([]);
  });
});

describe('helpers', () => {
  it('splits recovery codes on whitespace, commas and newlines alike', () => {
    // People paste these from a printed sheet, a screenshot or an email. One
    // definition of the split rule, so the form and the screen cannot disagree.
    const fields: SecretField[] = [{ kind: 'recovery_codes', value: '8f2k-91mz\nqq31-77bd, zz09-1234\n\n  ' }];
    expect(recoveryCodesOf(fields)).toEqual(['8f2k-91mz', 'qq31-77bd', 'zz09-1234']);
    expect(recoveryCodesOf([])).toEqual([]);
  });

  it('finds a value by kind', () => {
    const fields: SecretField[] = [{ kind: 'password', value: 'x' }];
    expect(valueOf(fields, 'password')).toBe('x');
    expect(valueOf(fields, 'totp')).toBeNull();
  });

  it('lists the kinds present, sorted and deduplicated', () => {
    // The value destined for the phase-1 `secret_kinds` column. Defined here so
    // whoever wires that column does not re-derive it.
    expect(secretKindsOf([{ kind: 'totp', value: 'a' }, { kind: 'password', value: 'b' }])).toBe('password,totp');
    expect(secretKindsOf([])).toBe('');
  });
});
