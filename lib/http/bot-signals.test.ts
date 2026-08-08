/**
 * Tests for the invisible bot signals.
 *
 * The load-bearing assertion is the fail-open one: anything malformed, absent
 * or nonsensical must come back 'unknown', never 'too-fast'. A heuristic that
 * can silently discard real leads would recreate the exact failure the dual
 * DB-plus-email record exists to prevent — and would do it invisibly, during
 * the one window where a low number kills the product.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';

import {
  submissionSpeedVerdict,
  MIN_HUMAN_FILL_MS,
  MAX_PLAUSIBLE_AGE_MS,
} from './bot-signals';

const NOW = 1_700_000_000_000;

describe('submissionSpeedVerdict', () => {
  it('flags an instant submission', () => {
    expect(submissionSpeedVerdict(NOW, NOW)).toBe('too-fast');
  });

  it('flags anything under the human threshold', () => {
    expect(submissionSpeedVerdict(NOW - (MIN_HUMAN_FILL_MS - 1), NOW)).toBe('too-fast');
  });

  it('accepts a submission exactly at the threshold', () => {
    expect(submissionSpeedVerdict(NOW - MIN_HUMAN_FILL_MS, NOW)).toBe('plausible');
  });

  it('accepts an unhurried human', () => {
    expect(submissionSpeedVerdict(NOW - 45_000, NOW)).toBe('plausible');
  });

  it('accepts a numeric string, since JSON round-trips vary', () => {
    expect(submissionSpeedVerdict(String(NOW - 30_000), NOW)).toBe('plausible');
  });
});

describe('fail-open — these must NEVER be too-fast', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['non-numeric text', 'yesterday'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -1],
    ['an object', { t: 1 }],
    ['an array', [NOW]],
    ['a boolean', true],
  ])('%s is unknown, not a bot', (_label, value) => {
    expect(submissionSpeedVerdict(value, NOW)).toBe('unknown');
  });

  it('treats a future timestamp as unknown — a skewed clock is not evidence', () => {
    expect(submissionSpeedVerdict(NOW + 60_000, NOW)).toBe('unknown');
  });

  it('treats a stale tab as unknown rather than judging it', () => {
    expect(submissionSpeedVerdict(NOW - MAX_PLAUSIBLE_AGE_MS - 1, NOW)).toBe('unknown');
  });

  it('still judges a submission just inside the staleness bound', () => {
    expect(submissionSpeedVerdict(NOW - MAX_PLAUSIBLE_AGE_MS + 1, NOW)).toBe('plausible');
  });
});
