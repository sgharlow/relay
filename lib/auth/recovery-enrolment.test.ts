/**
 * Tests for replacement-authenticator enrolment.
 *
 * The load-bearing one is token separation. If a signup enrolment token were
 * replayable as a recovery token, anyone who could start a signup could rewrite
 * an existing account's authenticator — which is a full account takeover
 * against a vault of someone's parent's credentials.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1, 17.1
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createHmac } from 'crypto';

import { beginRecoveryEnrolment, completeRecoveryEnrolment } from './recovery-enrolment';
import { generateTotpCodeFor } from './totp';
import { ValidationError } from '../validation';

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-recovery';
});

describe('beginRecoveryEnrolment', () => {
  it('issues a token, a secret and a scannable url', () => {
    const r = beginRecoveryEnrolment('u-1', 'margaret@example.com');
    expect(r.enrolmentToken).toContain('.');
    expect(r.totpSecret).toMatch(/^[A-Z2-7]+$/);
    expect(r.otpauthUrl).toContain('otpauth://totp/Relay:margaret%40example.com');
  });

  it('issues a DIFFERENT secret each time', () => {
    const a = beginRecoveryEnrolment('u-1', 'a@b.com');
    const b = beginRecoveryEnrolment('u-1', 'a@b.com');
    expect(a.totpSecret).not.toBe(b.totpSecret);
  });
});

describe('completeRecoveryEnrolment', () => {
  it('returns the user and secret for a valid code', () => {
    const r = beginRecoveryEnrolment('u-1', 'a@b.com');
    const code = generateTotpCodeFor(r.totpSecret);

    expect(completeRecoveryEnrolment(r.enrolmentToken, code)).toEqual({
      userId: 'u-1',
      secret: r.totpSecret,
    });
  });

  it('rejects a wrong code', () => {
    const r = beginRecoveryEnrolment('u-1', 'a@b.com');
    expect(() => completeRecoveryEnrolment(r.enrolmentToken, '000000')).toThrow(ValidationError);
  });

  it('rejects a tampered token', () => {
    const r = beginRecoveryEnrolment('u-1', 'a@b.com');
    const [payload] = r.enrolmentToken.split('.');
    expect(() => completeRecoveryEnrolment(`${payload}.forged`, '123456')).toThrow(
      /not valid/,
    );
  });

  it('rejects a token signed with a different server secret', () => {
    const r = beginRecoveryEnrolment('u-1', 'a@b.com');
    const code = generateTotpCodeFor(r.totpSecret);
    process.env.NEXTAUTH_SECRET = 'a-different-secret';
    expect(() => completeRecoveryEnrolment(r.enrolmentToken, code)).toThrow(/not valid/);
  });

  it('REJECTS a token whose purpose is not recovery — no cross-flow replay', () => {
    // Hand-roll a token with signup's purpose, signed correctly. If this were
    // accepted, starting a signup would let an attacker rewrite an existing
    // account's authenticator.
    const claims = {
      purpose: 'signup-enrolment',
      userId: 'victim',
      email: 'victim@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const mac = createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('base64url');

    expect(() => completeRecoveryEnrolment(`${payload}.${mac}`, '123456')).toThrow(/not valid/);
  });

  it('rejects an expired token', () => {
    const claims = {
      purpose: 'recovery-enrolment',
      userId: 'u-1',
      email: 'a@b.com',
      secret: 'JBSWY3DPEHPK3PXP',
      exp: Math.floor(Date.now() / 1000) - 1,
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const mac = createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('base64url');

    expect(() => completeRecoveryEnrolment(`${payload}.${mac}`, '123456')).toThrow(/expired/);
  });
});
