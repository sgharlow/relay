/**
 * G1 caregiver-wedge landing — the willingness-to-pay test instrument.
 *
 * Gate g1-caregiver-wtp (PROJECT.yaml): >=2% click-to-intent at a real price,
 * N>=100 qualified visitors; kill <0.5%. The intent event is a click-through to
 * /caregivers/interest with the price already shown. Copy leads with
 * REVERSIBILITY per docs/COMPETITORS.md.
 *
 * Amber-led: caregivers are the access-mode audience emotionally, even though
 * they buy as owners.
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import Link from 'next/link';

import {
  CTA_LABEL,
  DIFFERENTIATORS,
  HEADLINE,
  intentHref,
  PRICE_YEARLY_USD,
  SUBHEAD,
  TRUST_POINTS,
} from './content';
import QualifiedTracker from './QualifiedTracker';

export const metadata = {
  title: 'Relay for caregivers — emergency access that closes itself',
  description:
    'One encrypted vault for a parent’s accounts and instructions. Opens for you in a real emergency, seals itself when they recover. Reversible by design.',
};

export default function CaregiversLanding() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <QualifiedTracker />
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Relay</span>
          <span className="hidden text-xs text-slate-400 sm:inline">for the ones who step in</span>
        </div>
        <Link
          href={intentHref('nav')}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-amber-400"
        >
          Get started
        </Link>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-800">
        <div className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            For adult children caring for aging parents
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            {HEADLINE}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{SUBHEAD}</p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href={intentHref('hero')}
              className="rounded-md bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              {CTA_LABEL}
            </Link>
            <span className="text-sm text-slate-400">
              One price, the whole family. Cancel anytime.
            </span>
          </div>
        </div>
      </section>

      {/* The moment it's for */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            The call comes. Then the lockouts start.
          </h2>
          <p className="mt-4 leading-relaxed text-slate-300">
            The bank. The insurance portal. The pharmacy account. The email that resets all of them.
            Most families solve this ahead of time the only way they know how — by handing over
            every password to everyone, forever. That works right up until it doesn&apos;t, and it
            can never be undone.
          </p>
          <p className="mt-4 leading-relaxed text-slate-300">
            Relay is the other way: a vault your parent controls while they can, that opens{' '}
            <span className="text-white">only what each person needs, only when a real trigger fires</span>{' '}
            — and that <span className="text-amber-300">closes itself when they recover</span>.
          </p>
        </div>
      </section>

      {/* Differentiators */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Why not the alternatives you&apos;ve already considered?
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.them} className="rounded-xl border border-slate-800 bg-slate-950 p-6">
                <div className="text-sm font-semibold text-slate-200">{d.them}</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{d.problem}</p>
                <p className="mt-4 border-t border-slate-800 pt-4 text-sm leading-relaxed text-amber-200/90">
                  {d.relay}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Built like it matters</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          {TRUST_POINTS.map((t) => (
            <li
              key={t}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-sm leading-relaxed text-slate-300"
            >
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* Price + CTA */}
      <section className="border-t border-slate-800">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              One plan
            </div>
            <div className="mt-3 text-5xl font-bold tracking-tight">
              ${PRICE_YEARLY_USD}
              <span className="text-lg font-medium text-slate-400">/year</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              One vault, unlimited recipients and triggers, every release reversible until the one
              that shouldn&apos;t be.
            </p>
            <Link
              href={intentHref('pricing')}
              className="mt-6 inline-block rounded-md bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              {CTA_LABEL}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-semibold text-slate-300">Relay</span> — standby access for the
            people who&apos;ll need it.
          </div>
          <Link href="/" className="transition-colors hover:text-slate-300">
            About Relay
          </Link>
        </div>
      </footer>
    </main>
  );
}
