/**
 * The shared input rules — in particular the one that decides what a person's
 * name may contain.
 *
 * 🔴 WHY A NAME NEEDED A RULE AT ALL. A contact's name is interpolated into the
 * body of mail Relay sends from its own domain (`Hi ${name},`), and the owner's
 * display name into the SUBJECT. Both were bounded by nothing but
 * `isNonEmptyString`, on routes reachable by anyone who signed up. That is the
 * same class already closed once on the access-request `reason`
 * (lib/release/access-request.ts) — attacker-controlled text leaving on Relay's
 * reputation.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { cleanPersonName, MAX_PERSON_NAME_LENGTH, ValidationError, isUuid } from './validation';

describe('cleanPersonName', () => {
  it('keeps an ordinary name exactly as written', () => {
    expect(cleanPersonName('Dr. Alex Chen')).toBe('Dr. Alex Chen');
  });

  it('keeps names that are not ASCII', () => {
    // The rule bounds length and whitespace, and must not become an accidental
    // policy about whose names are real.
    expect(cleanPersonName('María José Ortiz-Gómez')).toBe('María José Ortiz-Gómez');
    expect(cleanPersonName('陳大文')).toBe('陳大文');
  });

  it('collapses a newline instead of carrying it into a message', () => {
    expect(cleanPersonName(['Alex Chen', 'Bcc: someone@example.com'].join('\n'))).toBe(
      'Alex Chen Bcc: someone@example.com',
    );
  });

  it('collapses carriage returns and tabs too', () => {
    // CRLF is what a mail header actually splits on, so \r matters as much as \n.
    expect(cleanPersonName('Alex\r\n\tChen')).toBe('Alex Chen');
  });

  it('collapses runs of ordinary spaces', () => {
    expect(cleanPersonName('Alex     Chen')).toBe('Alex Chen');
  });

  it('trims the ends', () => {
    expect(cleanPersonName('   Alex Chen  ')).toBe('Alex Chen');
  });

  it('refuses a name longer than the cap rather than truncating it', () => {
    // Truncating the name somebody will be recognised by is worse than saying it
    // did not fit — the same rule the display name already followed.
    expect(() => cleanPersonName('x'.repeat(MAX_PERSON_NAME_LENGTH + 1))).toThrow(ValidationError);
  });

  it('accepts a name of exactly the cap', () => {
    const exact = 'x'.repeat(MAX_PERSON_NAME_LENGTH);
    expect(cleanPersonName(exact)).toBe(exact);
  });

  it('measures length AFTER collapsing, so padding cannot be smuggled in', () => {
    const padded = 'Alex' + ' '.repeat(500) + 'Chen';
    expect(cleanPersonName(padded)).toBe('Alex Chen');
  });

  it('refuses a value that is only whitespace', () => {
    // `isNonEmptyString` passed this: a string of spaces has length > 0. It would
    // have produced "Hi ," in an email.
    expect(() => cleanPersonName('     ')).toThrow(ValidationError);
    expect(() => cleanPersonName('\n\n')).toThrow(ValidationError);
  });

  it('refuses a missing or non-string value', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(() => cleanPersonName(bad)).toThrow(ValidationError);
    }
  });

  it('names the field it refused, so a form can point at it', () => {
    const err = (() => {
      try {
        cleanPersonName('', 'displayName');
      } catch (e) {
        return e as ValidationError;
      }
    })();
    expect(err?.field).toBe('displayName');
  });
});

describe('isUuid', () => {
  it('accepts the canonical form the app generates, in either case', () => {
    expect(isUuid('fc3ee2d3-eb86-40d1-b099-37fde0270656')).toBe(true);
    expect(isUuid('FC3EE2D3-EB86-40D1-B099-37FDE0270656')).toBe(true);
  });

  it('rejects anything that would reach the driver as a cast error', () => {
    for (const bad of ['', 'not-a-uuid', '123', 'fc3ee2d3eb8640d1b09937fde0270656', null, 7]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});
