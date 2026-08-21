/**
 * What somebody sees on /start after they have paid.
 *
 * 🔴 THE FILE HAD NEVER BEEN TESTED AT ALL, and a behaviour change landed in it:
 * `?checkout=success` now suppresses the price card and substitutes an
 * acknowledgement. The evidence offered for that change was the checkout route's
 * `success_url` tests, which prove where Stripe is told to send the buyer and
 * say nothing about what the buyer then meets.
 *
 * ⚠️ THE PROPERTY THAT MATTERS MOST HERE IS A NEGATIVE ONE. The acknowledgement
 * reflects a QUERY PARAMETER, which anyone can type, and the code comment says
 * so — but a comment is a request to remember. It reads the parameter rather
 * than the subscription on purpose: the browser's return from Stripe can beat
 * the webhook, so a real entitlement read would often tell somebody who had just
 * paid that they were on the free plan. That makes "this grants nothing" a
 * property to pin, not prose: the failure mode is somebody later "improving" it
 * into an entitlement read, which would both break the race AND put a trust
 * decision behind a URL.
 *
 * `renderToStaticMarkup` needs no DOM and no new dependency, matching
 * `price-card.test.tsx`. Effects do not run under it, which keeps SeedWizard's
 * and RevealCard's fetches out of the way. It reaches the SEED phase only —
 * `phase` advances on a click and there is no testing-library here — so the
 * post-reveal card is covered at source level below and by nothing stronger.
 * Recorded as the weaker half deliberately.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R9, J12-R1
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const search = { current: new URLSearchParams() };
vi.mock('next/navigation', () => ({ useSearchParams: () => search.current }));

import StartClient from './StartClient';

function textAt(queryString: string): string {
  search.current = new URLSearchParams(queryString);
  return renderToStaticMarkup(<StartClient />)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('the buyer coming back from Stripe', () => {
  /*
    `/api/stripe/checkout` sends an owner with an EMPTY vault to /start rather
    than to a dashboard reading "Nothing here yet", so this person arrives
    mid-flow having already paid. Being asked to fill in eight prompts with no
    word about the money that just left is how a purchase feels like a mistake.
  */
  it('acknowledges the payment before the wizard, not after it', () => {
    expect(textAt('checkout=success')).toContain('Your plan has started');
  });

  it('says nothing about a plan to somebody who has not just bought one', () => {
    expect(textAt('')).not.toContain('Your plan has started');
  });

  /*
    The parameter is the ONLY thing that decides this, so a wrong value must
    read as "not paid" rather than as anything else — an unrecognised value
    landing on the acknowledgement would mean any /start link could be made to
    claim somebody had paid.
  */
  it('treats any other value of the parameter as not-paid', () => {
    for (const q of ['checkout=cancel', 'checkout=', 'checkout=SUCCESS', 'checkout=success1']) {
      expect(textAt(q), q).not.toContain('Your plan has started');
    }
  });
});

/**
 * The negative property, asserted on the source because there is nothing to
 * render it from: an import that is absent cannot be rendered.
 */
describe('the acknowledgement grants nothing', () => {
  const source = readFileSync('src/app/(owner)/start/StartClient.tsx', 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  );

  it('reads the query string, not the subscription', () => {
    expect(source).toContain('useSearchParams');
  });

  it('does not read entitlement, which would break the webhook race it exists for', () => {
    expect(source).not.toMatch(/getEntitlement|assertWithin|assertCanRelease|TIER_LIMITS/);
    expect(source, 'this component may not consult lib/billing at all').not.toMatch(/lib\/billing/);
  });
});
