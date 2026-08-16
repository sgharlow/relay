/**
 * The one button in the product that takes money.
 *
 * Its label was JSX text and became a template literal when the busy state was
 * added — `$` + `{price}` versus `$${price}` — which is exactly the edit that
 * silently renders "Keep my vault — $$119/yr" or drops the sign entirely.
 * `tsc` cannot see it and the build cannot see it, because both spellings are
 * valid; only rendering can.
 *
 * `renderToStaticMarkup` needs no DOM and no new dependency, matching
 * circle-surfaces.test.tsx. Effects do not run under it, which is what keeps
 * the analytics call in `useEffect` out of the way here.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import PriceCard from './PriceCard';
import { PRICE_YEARLY_USD } from '../../caregivers/content';

const markup = () => renderToStaticMarkup(<PriceCard />);
const text = (m: string) => m.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('the price CTA', () => {
  it('renders the price once, with exactly one dollar sign', () => {
    const t = text(markup());
    expect(t).toContain(`Keep my vault — $${PRICE_YEARLY_USD}/yr`);
    expect(t).not.toContain('$$');
  });

  /*
    It must start pressable. A busy-state bug that shipped `disabled` on first
    paint would make the product unbuyable while every test about the emit
    behaviour still passed — the checkout path would simply never be reached.
  */
  it('starts enabled, so the product can actually be bought', () => {
    expect(markup()).not.toMatch(/<button[^>]*disabled/);
  });

  it('offers the guarantee beside the button rather than after the sale', () => {
    expect(text(markup()).toLowerCase()).toContain('money-back');
  });
});
