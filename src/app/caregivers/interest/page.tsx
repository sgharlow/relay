/**
 * G1 intent page — landing here (with the price already seen) IS the intent event.
 * Measured as pageviews segmented by ?src= (Vercel Web Analytics).
 *
 * The gate metric is unchanged by the capture form below it: intent still fires
 * on mount, from IntentTracker, before anything is submitted. The form does not
 * move the numerator — it turns a measured intent into a contactable human,
 * which the previous mailto:-only version did not do for mobile visitors.
 *
 * No longer DB-free. That note dated from the assumption that the demo DSQL
 * infra would be torn down after judging; it was kept by Steve's ruling, and a
 * lead that exists only in an email is one silent send failure from being lost.
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import Link from 'next/link';

import { PRICE_YEARLY_USD } from '../content';
import InterestForm from './InterestForm';
import IntentTracker from './IntentTracker';

export const metadata = {
  title: 'Relay for caregivers — you’re early, and that’s good',
  robots: { index: false },
};

export default function CaregiverInterest() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <IntentTracker />
      <div className="max-w-lg text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-ochre bg-ochre-soft px-3 py-1 text-t1 text-ochre-text">
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Founding families
        </p>
        <h1 className="mt-5 text-t7 font-bold tracking-tight sm:text-t9">
          You can start right now.
        </h1>
        <p className="mt-4 leading-relaxed text-muted">
          Relay&apos;s vault, triggers and reversible release engine are built and running. Set it
          up yourself in a few minutes for ${PRICE_YEARLY_USD}/yr — or tell us about your situation
          and we&apos;ll walk you through it personally, at the same price.
        </p>
        <InterestForm />

        <Link
          href="/caregivers"
          className="mt-8 inline-flex min-h-[44px] items-center text-t2 text-muted hover:text-muted"
        >
          ← Back
        </Link>
      </div>
    </main>
  );
}
