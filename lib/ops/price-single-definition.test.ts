/**
 * The price is defined once, and nothing else writes the number down.
 *
 * 🔴 IT WAS WRITTEN DOWN IN NINE PLACES, and one of them was a SQL literal:
 *
 *     INSERT INTO subscriptions (… price_cents …) VALUES ($1, $2, $3, 11900, …)
 *
 * so the row recording what a customer paid was a restatement of the list price
 * rather than an observation of the payment.
 *
 * That was days from mattering rather than theoretical. `PriceCard.tsx` reads
 * `NEXT_PUBLIC_PRICE_YEARLY_USD` at runtime deliberately — "Runtime-configurable
 * so a price test does not require a deploy (J1-R8)" — and the G1 gate is
 * "click-to-intent AT A REAL PRICE POINT". Showing $99, charging $99 and
 * recording $119 was the intended operation meeting a hardcoded number, and the
 * corrupted column is the one any revenue question would be answered from.
 *
 * The webhook now records what Stripe says it charged. This test guards the
 * other half: that the number itself has one home, so the next person who needs
 * it imports it instead of typing it.
 *
 * COMMENTS ARE EXEMPT, for the reason four other checks in this repo strip them:
 * the code has to be able to EXPLAIN the price — "$119/yr was ratified against
 * the Everplans anchor" — and a check that cannot tell an explanation from a use
 * gets silenced, after which it guards nothing.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PRICE_YEARLY_USD, PRICE_YEARLY_CENTS } from '../offer';

/** Where the number is allowed to appear, because it is defined there. */
const DEFINITION = 'lib/offer.ts';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full.split('\\').join('/'));
    }
  }
  return out;
}

/** Strips block and line comments, so prose about the price is not a use of it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('the yearly price has exactly one definition', () => {
  const files = [...sourceFiles('lib'), ...sourceFiles('src')].filter(
    (f) => !f.endsWith(DEFINITION),
  );

  it('scans a real number of files, so this is not vacuous', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no source file outside lib/offer.ts writes the price as a literal', () => {
    // Both units: the dollars a person reads and the cents Stripe moves.
    const patterns = [
      new RegExp(`\\$${PRICE_YEARLY_USD}\\b`),
      new RegExp(`\\b${PRICE_YEARLY_CENTS}\\b`),
    ];

    const offenders = files.filter((f) => {
      const c = code(readFileSync(f, 'utf8'));
      return patterns.some((p) => p.test(c));
    });

    expect(
      offenders,
      `these write the price as a literal instead of importing it from ${DEFINITION}:\n` +
        offenders.map((f) => `  ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('the cents form really is the dollars form, so the two cannot drift', () => {
    expect(PRICE_YEARLY_CENTS).toBe(PRICE_YEARLY_USD * 100);
  });
});
