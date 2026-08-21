'use client';

/**
 * The G1 price surface — shown only AFTER the reveal (J1-R6).
 *
 * `price_viewed` → `intent_clicked` is the click-to-intent the gate actually
 * wants to learn: willingness to pay measured after the product has proven the
 * stakes, not before (J1-R9).
 *
 * The price is read from one place (src/app/caregivers/content.ts), with an
 * environment override on the DISPLAYED number only. ~~a runtime override so it
 * can be tested without a deploy (J1-R8)~~ — corrected 2026-08-21: the override
 * is `NEXT_PUBLIC_*`, which Next inlines at BUILD time, so it has never been
 * changeable without a deploy, and it moves the label rather than the charge.
 * See `priceUsd()` below and `lib/billing/price-display.test.ts`.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R8, J1-R9, J1-R10
 */

import { useEffect, useRef, useState } from 'react';

import { PRICE_YEARLY_USD, ANCHOR } from '../../caregivers/content';
import { emitFunnel, resolveChannel } from '../../../../lib/analytics/funnel';
import { completeLaneBIntent, LANE_B_FALLBACK_HREF } from '../../../../lib/analytics/lane-b';
import {
  classifyCheckoutFailure,
  shouldFallBackToInterestPage,
  type CheckoutFailure,
} from '../../../../lib/billing/checkout-outcome';
import { GUARANTEE_LABEL } from '../../../../lib/offer';
import { buttonPrimary, buttonQuiet, cardPadded, errorText, meta, muted } from '../_lib/ui';

/**
 * The displayed price.
 *
 * ⚠️ THE COMMENT HERE READ "Runtime-configurable so a price test does not
 * require a deploy (J1-R8)" AND THAT WAS NOT TRUE. `NEXT_PUBLIC_*` variables
 * are inlined by Next at BUILD time, so this component ships with whatever
 * value the build saw; changing it needs a redeploy exactly like changing the
 * constant would. The claim was repeated into two other files' headers from
 * here, which is how a wrong sentence becomes a fact about the codebase.
 *
 * The second half is worth stating plainly too: this override moves ONLY the
 * number on the screen. `POST /api/stripe/checkout` charges
 * `RELAY_PLAN.priceId` — a fixed Stripe Price — so setting this to 99 shows
 * $99 and charges $119. `.env.example` says so; nothing enforced it. Since the
 * G1 paid price test is retired, the override is kept for one honest use (a
 * deliberate, deployed price change) and `lib/billing/price-display.test.ts`
 * now holds the rule that it must not be used to show a number the checkout
 * will not charge.
 */
function priceUsd(): number {
  const override = Number(process.env.NEXT_PUBLIC_PRICE_YEARLY_USD);
  return Number.isFinite(override) && override > 0 ? override : PRICE_YEARLY_USD;
}

export default function PriceCard() {
  const [delivered, setDelivered] = useState<boolean | null>(null);
  /*
    The button waits on a Stripe round-trip — commonly a second or more — before
    the browser navigates. Until this it said nothing while that happened, and a
    button that does not acknowledge a press gets pressed again. That was not
    only a poor moment; every extra press emitted the G1 gate numerator again
    (see lib/analytics/lane-b.ts) and opened another Checkout Session.

    `busy` is deliberately never cleared. Both outcomes of `onIntent` navigate
    away, so the only state after a successful press is "leaving" — and
    re-enabling the button during that window would re-open exactly the gap
    this closes. The sibling intent surface, InterestForm on
    /caregivers/interest, has guarded its submit this way all along; this is the
    one that takes money and did not.
  */
  const [busy, setBusy] = useState(false);
  /*
    THERE IS A THIRD OUTCOME NOW, and the comment above used to say there were
    only two. A failure that is neither "Stripe is unconfigured" nor a working
    checkout leaves the owner exactly where they are, with a sentence saying so
    — so `busy` IS cleared on that path, or the button would sit disabled
    reading "Taking you to checkout…" while nothing was taking them anywhere.
  */
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  /*
    The status of the last attempt, held in a ref rather than state because
    `completeLaneBIntent` reads it back in the same tick — a state update would
    not have landed yet. `if (!res.ok) return null` used to discard it, which is
    precisely why every failure looked like the one the fallback was for.
  */
  const statusRef = useRef<number | null>(null);
  const price = priceUsd();

  useEffect(() => {
    void emitFunnel('price_viewed', {
      channel: resolveChannel(window.location.search),
      price: String(price),
    }).then(setDelivered);
  }, [price]);

  /**
   * One attempt at Stripe, recording WHY it failed.
   *
   * 🔴 THIS USED TO BE `if (!res.ok) return null`, and that single line sent
   * every rate-limited, 500-ing or disconnected press to `/caregivers/interest`
   * — a marketing page whose primary call to action asks a signed-in owner to
   * sign up, beside a form inviting them to join a waitlist they are past. The
   * fallback was written for the 503 case and the comment below says so; it
   * simply had no way to tell 503 from anything else, because the status was
   * thrown away here.
   */
  async function attemptCheckout(): Promise<string | null> {
    statusRef.current = null;
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      statusRef.current = res.status;
      if (!res.ok) return null;
      const { url } = (await res.json()) as { url?: string };
      return url ?? null;
    } catch {
      // A thrown request has no status, and that is a different fact from a 503.
      statusRef.current = null;
      return null;
    }
  }

  async function onIntent() {
    if (busy) return;
    setBusy(true);

    /*
      A RETRY MUST NOT RE-EMIT. `completeLaneBIntent` memoises one intent per
      page load on purpose — the G1 numerator is meant to count a decision, not
      a press — so a second attempt after a recoverable failure goes straight to
      Stripe. That is the same rule the memo encodes, applied rather than
      circumvented: the intent was already counted, and this press is the same
      intent trying again.
    */
    if (failure) {
      const retryUrl = await attemptCheckout();
      if (retryUrl) {
        window.location.href = retryUrl;
        return;
      }
      setFailure(classifyCheckoutFailure(statusRef.current));
      setBusy(false);
      return;
    }

    // Try real checkout first. It 503s until Stripe is configured, and the interest
    // page is the fallback. That ordering matters: the button says "Keep my vault —
    // $119/yr", and sending someone who wants to pay to a waitlist when checkout
    // exists would be a bait.
    //
    // completeLaneBIntent owns the measurement, because the two branches must emit
    // DIFFERENT things: the Stripe branch takes the visitor away from
    // /caregivers/interest, so it has to emit the gate numerator itself, while the
    // fallback branch must NOT — that page emits its own. Getting this wrong either
    // loses every paying Lane-B visitor from the gate (which is what shipped between
    // 2026-08-08 and 2026-08-10) or counts one click twice. See lib/analytics/lane-b.ts.
    const href = await completeLaneBIntent({
      search: window.location.search,
      price: String(price),
      startCheckout: attemptCheckout,
    });

    if (href !== LANE_B_FALLBACK_HREF) {
      window.location.href = href;
      return;
    }

    // The fallback was chosen. Whether that is right depends on WHY checkout
    // failed, which is the question lib/billing/checkout-outcome.ts answers.
    const outcome = classifyCheckoutFailure(statusRef.current);
    if (shouldFallBackToInterestPage(outcome)) {
      window.location.href = href;
      return;
    }

    setFailure(outcome);
    setBusy(false);
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
          disabled={busy || failure?.retryable === false}
          aria-busy={busy}
          style={{
            ...buttonPrimary,
            width: '100%',
            marginTop: 'var(--s6)',
            opacity: busy || failure?.retryable === false ? 0.6 : 1,
          }}
        >
          {busy
            ? 'Taking you to checkout…'
            : failure?.retryable
              ? 'Try again'
              : `Keep my vault — $${price}/yr`}
        </button>

        {failure && (
          /*
            On the page they are already on, not on a page that asks them to
            sign up. `role="status"` rather than `alert`: this is information
            about a press that did not complete, not an emergency, and the tone
            of everything in this product on a bad day is the point.
          */
          <div role="status" style={{ marginTop: 'var(--s3)' }}>
            <p style={errorText}>{failure.message}</p>
            {failure.href && (
              <a
                href={failure.href}
                style={{ ...buttonQuiet, display: 'inline-block', marginTop: 'var(--s2)' }}
              >
                {failure.hrefLabel ?? 'Continue'}
              </a>
            )}
          </div>
        )}

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
