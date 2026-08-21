/**
 * The lead form must quote the one commitment, not a friendlier one.
 *
 * 🔴 IT PROMISED A FASTER ANSWER THAN THE OPERATOR AGREED TO. This screen said
 * "you'll hear back within a day"; `SUPPORT_RESPONSE_TIME` is "within one
 * business day", ruled 2026-08-20 and chosen deliberately — "honest for a solo
 * operator on his worst week rather than flattering on his best". A form
 * submitted on a Friday evening promised Saturday.
 *
 * ⚠️ AND THE GUARD THAT EXISTS FOR THIS DID NOT SEE IT. lib/ops/support-commitment.test.ts
 * sweeps every .tsx under src/app for a rival response time, which is exactly
 * this — but its pattern enumerates the quantities it expects ("a few", a digit,
 * one, two, three, 24, 48) and has no bare article, so the phrase "within a day"
 * passed a sweep whose stated job is finding a second surface stating a different
 * number. The lane fix is one alternation in that regex; this file is the local
 * half, and it does not depend on that regex at all.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { SUPPORT_RESPONSE_TIME } from '../../../../lib/contact';

const FORM = 'src/app/caregivers/interest/InterestForm.tsx';

const copy = () =>
  readFileSync(FORM, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

describe('the interest form states the ruled response time', () => {
  it('renders SUPPORT_RESPONSE_TIME rather than a second number', () => {
    expect(copy(), `${FORM} should consume the one definition`).toMatch(/SUPPORT_RESPONSE_TIME/);
  });

  it('states no rival time of its own, including bare-article ones', () => {
    /*
      The alternation the shared guard is missing. "within a day" and "within an
      hour" are response times a reader takes literally, and neither contains a
      quantity a number-shaped pattern can find.
    */
    const rival = /within (?:a|an|a few|one|two|three|\d+) (?:hour|hours|day|days)\b/i;
    const found = rival.exec(copy().replace(/SUPPORT_RESPONSE_TIME/g, ''));
    expect(
      found?.[0] ?? null,
      `${FORM} states its own response time — use SUPPORT_RESPONSE_TIME (${SUPPORT_RESPONSE_TIME})`,
    ).toBeNull();
  });

  it('still tells a submitter they will hear back at all', () => {
    // Removing the number must not remove the answer to "and then what?".
    expect(copy()).toMatch(/hear back/i);
  });
});
