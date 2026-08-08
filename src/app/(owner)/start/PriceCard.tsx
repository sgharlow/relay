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
    window.location.href = '/caregivers/interest?src=start';
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Keep this vault, and everything it protects</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          ${price}
          <span className="text-base font-normal text-slate-500">/year</span>
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {ANCHOR.name} charges ${ANCHOR.priceYearlyUsd}/yr to organise documents. Relay is the
          only one that opens on a verified trigger and closes itself again.
        </p>

        <ul className="mt-4 space-y-2 text-sm text-slate-700">
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
          className="mt-5 w-full rounded bg-amber-500 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-amber-400"
        >
          Keep my vault — ${price}/yr
        </button>

        <p className="mt-3 text-center text-xs text-slate-400">
          Free plan keeps your first 10 items. Nothing is deleted if you wait.
        </p>
      </div>

      {delivered === false && (
        <p className="text-xs text-amber-600">
          Measurement is not reaching analytics on this page load — the G1 reading from this
          session is not trustworthy.
        </p>
      )}
    </div>
  );
}
