'use client';

/**
 * First-run flow: prompted seed → zero-knowledge moment → risk-graph reveal →
 * price.
 *
 * The order is a requirement, not a layout choice. The paywall lands at peak
 * demonstrated value, after the reveal has turned the pitch into a fact
 * (J1-R6), and the G1 metric is measured across reveal → checkout rather than
 * landing → form (J1-R9).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R4, J1-R5, J1-R6, J1-R9
 */

import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import SeedWizard from './SeedWizard';
import RevealCard from './RevealCard';
import PriceCard from './PriceCard';
import { buttonPrimary, buttonQuiet, cardPadded, h1, muted } from '../_lib/ui';

type Phase = 'seed' | 'reveal' | 'price';

export default function StartClient() {
  const [phase, setPhase] = useState<Phase>('seed');

  /*
    🔴 `?checkout=success` WAS READ BY NOTHING. Stripe returned the buyer to
    `…?checkout=success` and a grep for that string across `src/` found exactly
    one hit: the line that wrote it. So a person handed over $119 and the
    product said nothing at all — no acknowledgement anywhere, and no tier shown
    on any screen.

    Worse on THIS page than on the vault, because `/start` ends at the price
    card: without this, somebody who had just paid would reach the bottom of the
    flow and be asked to pay again. (`POST /api/stripe/checkout` now refuses
    that with a 409, so the second charge is impossible — but being asked is
    still the wrong thing to show a customer.)

    ⚠️ THIS IS NOT AN ENTITLEMENT CHECK and must not be mistaken for one. It
    reflects a query parameter, which anyone can type. Nothing here grants
    anything; the tier comes from the webhook, and the parameter only decides
    which sentence is on the screen. The reason to read the parameter rather
    than the subscription is the race — the browser's return from Stripe can
    beat the webhook, so a real entitlement read here would often say "free" to
    somebody who had genuinely just paid.
  */
  const justPaid = useSearchParams().get('checkout') === 'success';

  const onSeedComplete = useCallback(() => setPhase('reveal'), []);
  const onRevealReady = useCallback(() => undefined, []);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header>
        <h1 style={h1}>
          {phase === 'seed' ? "Start with what you'd need first" : 'Here is what we found'}
        </h1>
        <p style={{ ...muted, marginTop: 'var(--s1)' }}>
          {phase === 'seed'
            ? 'If they were hospitalised tomorrow, these are the accounts you would reach for.'
            : 'Built from the accounts you just entered.'}
        </p>
      </header>

      {justPaid && phase === 'seed' && (
        /*
          The empty-vault buyer arrives HERE, mid-flow, having already paid —
          `/api/stripe/checkout` sends an owner with no items to `/start` rather
          than to a dashboard reading "Nothing here yet." They are owed an
          acknowledgement before the wizard, not after it: being asked to fill
          in eight prompts with no word about the money that just left is how a
          purchase feels like a mistake.
        */
        <p style={{ ...muted, fontWeight: 500 }}>
          Your plan has started — thank you. Let&rsquo;s put something in the vault.
        </p>
      )}

      {phase === 'seed' && <SeedWizard onComplete={onSeedComplete} />}

      {phase !== 'seed' && (
        <>
          <RevealCard onReady={onRevealReady} />

          {justPaid ? (
            <div style={cardPadded}>
              <p style={{ fontSize: 'var(--t3)', fontWeight: 600 }}>Your plan has started.</p>
              <p style={{ ...muted, marginTop: 'var(--s2)' }}>
                Nothing else is needed today. Your vault is yours, the limits are gone, and you can
                add the rest whenever you have a quiet half hour.
              </p>
              <a
                href="/vault"
                style={{
                  ...buttonPrimary,
                  display: 'inline-block',
                  width: '100%',
                  marginTop: 'var(--s4)',
                  textAlign: 'center',
                }}
              >
                Go to my vault
              </a>
            </div>
          ) : phase === 'reveal' ? (
            <button
              type="button"
              onClick={() => setPhase('price')}
              style={{ ...buttonQuiet, width: '100%' }}
            >
              Continue
            </button>
          ) : (
            <PriceCard />
          )}
        </>
      )}
    </div>
  );
}
