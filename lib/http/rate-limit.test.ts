/**
 * Tests for the public-endpoint rate limiter.
 *
 * Time is injected rather than slept, so window expiry is tested in
 * microseconds and deterministically.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { rateLimit, clientKey, _resetRateLimitForTesting } from './rate-limit';

const WINDOW = 60_000;

beforeEach(() => _resetRateLimitForTesting());

describe('rateLimit', () => {
  it('allows exactly the limit, then refuses', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, WINDOW, 1000).allowed).toBe(true);
    }
    expect(rateLimit('k', 3, WINDOW, 1000).allowed).toBe(false);
  });

  it('reports how long to wait, rounded up to whole seconds', () => {
    rateLimit('k', 1, WINDOW, 0);
    const r = rateLimit('k', 1, WINDOW, 500);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(60);
  });

  it('lets the client back in once the window has passed', () => {
    rateLimit('k', 1, WINDOW, 0);
    expect(rateLimit('k', 1, WINDOW, 100).allowed).toBe(false);
    expect(rateLimit('k', 1, WINDOW, WINDOW).allowed).toBe(true);
  });

  it('keeps separate counters per key — one abuser cannot lock everyone out', () => {
    rateLimit('a', 1, WINDOW, 0);
    expect(rateLimit('a', 1, WINDOW, 0).allowed).toBe(false);
    expect(rateLimit('b', 1, WINDOW, 0).allowed).toBe(true);
  });

  it('does not let a refused attempt extend the window', () => {
    rateLimit('k', 1, WINDOW, 0);
    rateLimit('k', 1, WINDOW, 30_000); // refused
    expect(rateLimit('k', 1, WINDOW, WINDOW).allowed).toBe(true);
  });
});

describe('clientKey', () => {
  it('uses the left-most x-forwarded-for entry — the client, not a proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' });
    expect(clientKey(h, 'lead')).toBe('lead:203.0.113.9');
  });

  it('falls back to x-real-ip', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.4' }), 'lead')).toBe('lead:198.51.100.4');
  });

  it('buckets unidentifiable clients together rather than exempting them', () => {
    expect(clientKey(new Headers(), 'lead')).toBe('lead:unknown');
  });

  it('namespaces by prefix so two endpoints do not share a budget', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9' });
    expect(clientKey(h, 'lead')).not.toBe(clientKey(h, 'signup'));
  });
});
