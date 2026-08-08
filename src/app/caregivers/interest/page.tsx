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
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <IntentTracker />
      <div className="max-w-lg text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Founding families
        </p>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
          We&apos;re onboarding the first families by hand.
        </h1>
        <p className="mt-4 leading-relaxed text-slate-300">
          Relay&apos;s vault, triggers, and reversible release engine are built and running. We
          onboard each founding family personally — same ${PRICE_YEARLY_USD}/yr, with direct access
          to us while we do it.
        </p>
        <InterestForm />

        <Link
          href="/caregivers"
          className="mt-8 inline-flex min-h-[44px] items-center text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back
        </Link>
      </div>
    </main>
  );
}
