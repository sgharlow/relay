'use client';

/**
 * The G1 price surface — shown only AFTER the reveal (J1-R6).
 *
 * `price_viewed` → `intent_clicked` is the click-to-intent the gate actually
 * wants to learn: willingness to pay measured after the product has proven the
 * stakes, not before (J1-R9).
 *
 * The price is read from one place (src/app/caregivers/content.ts) with a
 * runtime override so it can be tested without a deploy (J1-R8).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R8, J1-R9, J1-R10
 */

import { useEffect, useState } from 'react';

import { PRICE_YEARLY_USD, ANCHOR } from '../../caregivers/content';
import { emitFunnel, resolveChannel } from '../../../../lib/analytics/funnel';
import { GUARANTEE_LABEL } from '../../../../lib/offer';
import { buttonPrimary, cardPadded, meta, muted } from '../_lib/ui';

/** Runtime-configurable so a price test does not require a deploy (J1-R8). */
function priceUsd(): number {
  const override = Number(process.env.NEXT_PUBLIC_PRICE_YEARLY_USD);
  return Number.isFinite(override) && override > 0 ? override : PRICE_YEARLY_USD;
}

export default function PriceCard() {
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const price = priceUsd();

  useEffect(() => {
    void emitFunnel('price_viewed', {
      channel: resolveChannel(window.location.search),
      price: String(price),
    }).then(setDelivered);
  }, [price]);

  async function onIntent() {
    await emitFunnel('intent_clicked', {
      channel: resolveChannel(window.location.search),
      cta: 'start-price-card',
      price: String(price),
    });
    // Try real checkout first. It 503s until Stripe is configured, and the
    // interest page is the fallback — the G1 lane, which still fires
    // caregiver_intent, so the gate reads the same either way. That ordering
    // matters: the button says "Keep my vault — $119/yr", and sending someone
    // who wants to pay to a waitlist when checkout exists would be a bait.
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      if (res.ok) {
        const { url } = (await res.json()) as { url?: string };
        if (url) {
          window.location.href = url;
          return;
        }
      }
    } catch {
      /* fall through to the interest lane */
    }

    window.location.href = '/caregivers/interest?src=start';
  }

  return (
    <div className="space-y-4">
      <div style={{ ...cardPadded, padding: 'var(--s6)' }}>
        <p style={muted}>Keep this vault, and everything it protects</p>
        <p style={{ fontSize: 'var(--t7)', fontWeight: 600, letterSpacing: '-0.02em', marginTop: 'var(--s2)' }}>
          ${price}
          <span style={{ fontSize: 'var(--t3)', fontWeight: 400, color: 'var(--ink-muted)' }}>/year</span>
        </p>
        <p style={{ ...meta, marginTop: 'var(--s1)' }}>
          {ANCHOR.name} charges ${ANCHOR.priceYearlyUsd}/yr to organise documents. Relay is the
          only one that opens on a verified trigger and closes itself again.
        </p>

        <ul style={{ marginTop: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)', fontSize: 'var(--t3)', listStyle: 'none', padding: 0 }}>
          {/* NOT "documents". There is no file upload anywhere in the product —
              the only file input is the CSV importer — so selling document
              storage would be a claim the software cannot honour. "Where to
              find things" is what Relay actually does for a document: the
              instruction that says the will is in box 214 at First National,
              which is the useful half anyway. Revisit this line if upload ships. */}
          <li>Unlimited accounts, instructions, and where to find things</li>
          <li>As many recipients as your family needs</li>
          <li>Emergency access that reverses when they recover</li>
        </ul>

        <button
          type="button"
          onClick={onIntent}
          style={{ ...buttonPrimary, width: '100%', marginTop: 'var(--s6)' }}
        >
          Keep my vault — ${price}/yr
        </button>

        <p style={{ ...meta, marginTop: 'var(--s3)', textAlign: 'center' }}>
          {GUARANTEE_LABEL}. Free plan keeps your first 10 items. Nothing is deleted if you wait.
        </p>
      </div>

      {delivered === false && (
        <p style={{ fontSize: 'var(--t1)', color: 'var(--ochre-text)' }}>
          Measurement is not reaching analytics on this page load — the G1 reading from this
          session is not trustworthy.
        </p>
      )}
    </div>
  );
}
