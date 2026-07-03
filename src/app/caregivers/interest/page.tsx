/**
 * G1 intent page — landing here (with the price already seen) IS the intent event.
 * Measured as pageviews segmented by ?src= (Vercel Web Analytics; enable at deploy).
 * Deliberately DB-free: demo DSQL infra is torn down post-judging, and the G1 test
 * must not depend on it.
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import Link from 'next/link';

import { PRICE_YEARLY_USD } from '../content';

export const metadata = {
  title: 'Relay for caregivers — you’re early, and that’s good',
  robots: { index: false },
};

export default function CaregiverInterest() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
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
        <p className="mt-4 leading-relaxed text-slate-300">
          Email{' '}
          <a
            href={`mailto:hello@relay.example?subject=${encodeURIComponent('Founding family — Relay for caregivers')}`}
            className="font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-4 hover:text-amber-200"
          >
            hello@relay.example
          </a>{' '}
          with one line about your situation, and we&apos;ll reply within a day.
        </p>
        <Link href="/caregivers" className="mt-8 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Back
        </Link>
      </div>
    </main>
  );
}
