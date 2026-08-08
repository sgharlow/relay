/**
 * Tests for the role-concentration detector.
 *
 * This is a SAFETY requirement, not a UX suggestion. One adult child holding
 * delegate + sole recipient + sole verifier can grant themselves access and
 * confirm their own trigger with nobody else involved — the precise structure
 * that enables undetectable elder financial abuse (J3-R10).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R10
 */

import { describe, it, expect } from 'vitest';
import { detectRoleConcentration } from './role-concentration';

describe('detectRoleConcentration', () => {
  it('WARNS when one person is delegate, sole recipient, and sole verifier', () => {
    const w = detectRoleConcentration([
      { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
    ]);

    expect(w).not.toBeNull();
    expect(w!.severity).toBe('high');
    expect(w!.email).toBe('child@x.com');
    expect(w!.remedy.length).toBeGreaterThan(0);
  });

  it('clears when a second independent VERIFIER exists', () => {
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
        { email: 'neighbour@x.com', isDelegate: false, isRecipient: false, isVerifier: true },
      ]),
    ).toBeNull();
  });

  it('clears when a second independent RECIPIENT exists', () => {
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
        { email: 'sibling@x.com', isDelegate: false, isRecipient: true, isVerifier: false },
      ]),
    ).toBeNull();
  });

  it('does not warn on a delegate who is not also recipient and verifier', () => {
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: false, isVerifier: false },
      ]),
    ).toBeNull();
  });

  it('does not warn on a recipient+verifier who is not a delegate', () => {
    expect(
      detectRoleConcentration([
        { email: 'spouse@x.com', isDelegate: false, isRecipient: true, isVerifier: true },
      ]),
    ).toBeNull();
  });

  it('does not warn on an empty circle', () => {
    expect(detectRoleConcentration([])).toBeNull();
  });

  it('matches on NORMALISED email, so case and spacing cannot evade it', () => {
    const w = detectRoleConcentration([
      { email: ' Child@X.com ', isDelegate: true, isRecipient: true, isVerifier: true },
    ]);
    expect(w).not.toBeNull();
  });

  it('does not treat the same person listed twice as independent cover', () => {
    // The same human under two spellings is not a second party.
    expect(
      detectRoleConcentration([
        { email: 'child@x.com', isDelegate: true, isRecipient: true, isVerifier: true },
        { email: 'CHILD@X.com ', isDelegate: false, isRecipient: true, isVerifier: true },
      ]),
    ).not.toBeNull();
  });

  it('uses the same normalisation as the unified people list', async () => {
    const { normaliseEmail } = await import('./people');
    expect(normaliseEmail(' Child@X.com ')).toBe('child@x.com');
  });
});
