/**
 * Tests for /api/auth/signup — rate limiting.
 *
 * Signup was the only unauthenticated write endpoint in the app with no limit,
 * while recover, lead capture, checkout, access/code, access/resend and
 * verify/code all had one. Two things ride on closing that: an attacker can
 * otherwise create unbounded rows in the DSQL cluster, and — because
 * `beginSignup` reports "An account already exists for this email" — can grind
 * an address list to learn who uses Relay. For a product about who will access
 * a vulnerable person's accounts, that membership fact is itself sensitive.
 *
 * Feature: relay-g1-wtp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('../../../../../lib/auth/signup', () => ({
  validateSignupInput: vi.fn(() => ({ email: 'owner@example.com' })),
  beginSignup: vi.fn(async () => ({
    enrolmentToken: 'tok',
    otpauthUrl: 'otpauth://totp/Relay:owner@example.com?secret=AAAA&issuer=Relay',
  })),
  completeSignup: vi.fn(async () => ({ ownerId: 'owner-1', recoveryCodes: ['aaaa-bbbb'] })),
}));

import { beginSignup, completeSignup } from '../../../../../lib/auth/signup';
import { _resetRateLimitForTesting } from '../../../../../lib/http/rate-limit';
import { POST, PUT } from './route';

const mockBegin = vi.mocked(beginSignup);
const mockComplete = vi.mocked(completeSignup);

/** A request from a given client IP, as Vercel would present it. */
function reqFrom(ip: string, body: unknown): NextRequest {
  return new Request('https://relaystandby.com/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitForTesting();
});

describe('POST /api/auth/signup rate limiting', () => {
  it('allows a normal person their handful of attempts', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(reqFrom('1.2.3.4', { email: 'owner@example.com' }));
      expect(res.status).toBe(201);
    }
    expect(mockBegin).toHaveBeenCalledTimes(10);
  });

  it('429s the eleventh attempt from one address, with Retry-After', async () => {
    for (let i = 0; i < 10; i++) await POST(reqFrom('1.2.3.4', { email: 'owner@example.com' }));

    const res = await POST(reqFrom('1.2.3.4', { email: 'owner@example.com' }));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe('RateLimited');
  });

  it('does not consult the database once limited — no row, and no existence answer', async () => {
    for (let i = 0; i < 11; i++) await POST(reqFrom('1.2.3.4', { email: 'owner@example.com' }));

    // 10 allowed, the 11th refused before beginSignup could report whether the
    // address is taken. That ordering is the whole point: a limiter that runs
    // after the lookup still leaks the answer it was added to protect.
    expect(mockBegin).toHaveBeenCalledTimes(10);
  });

  it('limits per client address, so one abuser does not lock everyone out', async () => {
    for (let i = 0; i < 11; i++) await POST(reqFrom('1.2.3.4', { email: 'owner@example.com' }));

    const other = await POST(reqFrom('5.6.7.8', { email: 'owner@example.com' }));

    expect(other.status).toBe(201);
  });
});

describe('PUT /api/auth/signup rate limiting', () => {
  const completeBody = { enrolmentToken: 'tok', code: '123456' };

  it('429s once the code guesses run out', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await PUT(reqFrom('1.2.3.4', completeBody));
      expect(ok.status).toBe(200);
    }

    const res = await PUT(reqFrom('1.2.3.4', completeBody));

    expect(res.status).toBe(429);
    expect(mockComplete).toHaveBeenCalledTimes(10);
  });

  it('keeps its own budget, so enrolling does not spend the begin-signup allowance', async () => {
    for (let i = 0; i < 10; i++) await POST(reqFrom('1.2.3.4', { email: 'owner@example.com' }));

    // A person who typed their email a few times still has to be able to finish.
    const res = await PUT(reqFrom('1.2.3.4', completeBody));

    expect(res.status).toBe(200);
  });
});
