/**
 * Tests for access requests and owner-challenge-first.
 *
 * The naive design escalates every request straight to N-of-M. But a false
 * alarm burns the verification network's credibility for nothing, and an owner
 * who is conscious can simply say yes — asking three other people to vote on
 * something the owner is sitting right there agreeing to is absurd. Only the
 * owner-truly-unreachable case should consume verifier attention (J6-R2).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R2, J6-R4, J6-R6, J6-R7, J6-R8
 */

import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_WINDOW_SECONDS,
  MAX_REQUESTS_PER_WINDOW,
  VELOCITY_WINDOW_SECONDS,
  assertRequestAllowed,
  challengeExpiry,
} from './access-request';
import { ValidationError } from '../validation';

describe('CHALLENGE_WINDOW_SECONDS', () => {
  it('covers every trigger type', () => {
    for (const t of ['emergency', 'travel', 'caregiver', 'business', 'estate'] as const) {
      expect(CHALLENGE_WINDOW_SECONDS[t]).toBeGreaterThan(0);
    }
  });

  it('gives emergency the shortest window — someone is waiting', () => {
    const others = (['travel', 'caregiver', 'business', 'estate'] as const).map(
      (t) => CHALLENGE_WINDOW_SECONDS[t],
    );
    for (const w of others) expect(w).toBeGreaterThanOrEqual(CHALLENGE_WINDOW_SECONDS.emergency);
  });

  it('gives ESTATE the longest — it cannot be undone', () => {
    const all = Object.values(CHALLENGE_WINDOW_SECONDS);
    expect(CHALLENGE_WINDOW_SECONDS.estate).toBe(Math.max(...all));
  });
});

describe('challengeExpiry', () => {
  it('is the request time plus that trigger type window', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const exp = new Date(challengeExpiry('emergency', now));

    expect(exp.getTime() - now.getTime()).toBe(CHALLENGE_WINDOW_SECONDS.emergency * 1000);
  });

  it('falls back to the emergency window for an unknown type', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const exp = new Date(challengeExpiry('nonsense' as never, now));

    expect(exp.getTime() - now.getTime()).toBe(CHALLENGE_WINDOW_SECONDS.emergency * 1000);
  });
});

describe('assertRequestAllowed', () => {
  const now = new Date('2026-08-06T12:00:00Z');

  it('allows a first request', () => {
    expect(() => assertRequestAllowed([], now)).not.toThrow();
  });

  it('allows requests below the velocity limit', () => {
    expect(() => assertRequestAllowed([{ created_at: '2026-08-06T11:00:00Z' }], now)).not.toThrow();
  });

  it('REJECTS once the velocity limit is reached', () => {
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: '2026-08-06T11:00:00Z',
    }));
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('ignores requests outside the window', () => {
    const old = new Date(now.getTime() - (VELOCITY_WINDOW_SECONDS + 60) * 1000).toISOString();
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({ created_at: old }));
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('counts only requests strictly inside the window boundary', () => {
    const exactly = new Date(now.getTime() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({ created_at: exactly }));
    // On the boundary still counts — the limit is deliberately conservative.
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });
});
