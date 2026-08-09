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

import SeedWizard from './SeedWizard';
import RevealCard from './RevealCard';
import PriceCard from './PriceCard';
import { buttonQuiet, h1, muted } from '../_lib/ui';

type Phase = 'seed' | 'reveal' | 'price';

export default function StartClient() {
  const [phase, setPhase] = useState<Phase>('seed');

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

      {phase === 'seed' && <SeedWizard onComplete={onSeedComplete} />}

      {phase !== 'seed' && (
        <>
          <RevealCard onReady={onRevealReady} />

          {phase === 'reveal' ? (
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
