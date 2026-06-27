/**
 * Relay marketing landing page (public root).
 *
 * The front door for both audiences: Owners (who build a vault and sign in) and
 * Recipients (who arrive via an emailed /access?token link). Blue = Owner mode,
 * amber = Access mode — the product's two-mode duality is the visual through-line.
 *
 * Feature: relay-h0-mvp
 */

import Link from 'next/link';

export const metadata = {
  title: 'Relay — standby access for the people who will need it',
  description:
    'An encrypted living-continuity vault with scoped, reversible access. Emergencies are reversible; estate handoffs are permanent. Built on Amazon Aurora DSQL.',
};

const STATES = ['ARMED', 'PENDING', 'GRACE', 'RELEASED'] as const;

const STEPS = [
  {
    n: '01',
    title: 'Build the vault',
    body: 'Import a password-manager export or add accounts, documents, and instructions. An importance engine ranks what matters in a crisis — and shows that your primary email is the key that unlocks most password resets. It only ever sees non-secret metadata.',
  },
  {
    n: '02',
    title: 'Set the rules',
    body: 'Decide who gets which items, under which trigger — a missed check-in, a manual emergency, or a verified estate event — with N-of-M trusted verifiers and a grace window before anything opens.',
  },
  {
    n: '03',
    title: 'Controlled release',
    body: 'A trigger advances a state machine — ARMED → PENDING → GRACE → RELEASED — where every transition is a strongly-consistent compare-and-set on Aurora DSQL. It can never double-release, even when owner, verifiers, and scheduler all act at once.',
  },
  {
    n: '04',
    title: 'Reversible by default',
    body: 'Recover and check in, and emergency access closes again automatically. Estate handoffs are permanent. The default-safe state is always ARMED.',
  },
];

const STACK = [
  {
    k: 'Amazon Aurora DSQL',
    v: 'Active-active across regions, strongly consistent. The invariant — no double-spend, no oversell, no reconciliation — is owned by the database.',
  },
  {
    k: 'AWS KMS envelope encryption',
    v: 'Per-item AES-GCM-256 data key, wrapped by KMS. Plaintext never leaves your browser; the server only ever stores ciphertext.',
  },
  {
    k: 'Hash-chained audit',
    v: 'Every security event is an append-only, per-owner SHA-256 chain — tamper-evident and verifiable in the browser.',
  },
  {
    k: 'Next.js on Vercel',
    v: 'Two emotionally-distinct modes — dense blue Owner mode, calm amber Access mode — on one strongly-consistent ledger.',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Relay</span>
          <span className="hidden text-xs text-slate-400 sm:inline">Living-continuity vault</span>
        </div>
        <Link
          href="/auth/signin"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          Owner sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-800">
        <div className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-0 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Default state: ARMED
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            Standby access for the people who&apos;ll need it.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
            Relay is an encrypted vault of your accounts, credentials, and instructions — with{' '}
            <span className="text-white">scoped, reversible access</span> that opens only under rules
            you set. When you can&apos;t act, the right people can — and not a moment before.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/signin"
              className="rounded-md bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Owner sign in
            </Link>
            <span className="rounded-md border border-amber-500/40 bg-amber-500/5 px-5 py-3 text-sm text-amber-200">
              Received an access link? Open it from your email to reach your plan.
            </span>
          </div>

          {/* State-machine motif */}
          <div className="mt-14 flex flex-wrap items-center gap-2 text-xs font-medium">
            {STATES.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span
                  className={`rounded-md border px-3 py-1.5 tracking-wide ${
                    s === 'ARMED'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : s === 'RELEASED'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-slate-700 bg-slate-900/60 text-slate-300'
                  }`}
                >
                  {s}
                </span>
                {i < STATES.length - 1 && <span className="text-slate-600">→</span>}
              </span>
            ))}
            <span className="ml-1 text-slate-500">every transition strongly consistent</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How Relay works</h2>
        <p className="mt-2 max-w-2xl text-slate-400">
          A thin vault and a thick release engine. The hard part — being correct under pressure —
          is handled by the database, not by hope.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 transition-colors hover:border-slate-700"
            >
              <div className="font-mono text-sm text-blue-400">{s.n}</div>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two modes */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-7">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-300">Owner mode</div>
            <p className="mt-3 text-slate-300">
              Dense and deliberate. Build the vault, see the risk graph, set the rules, and arm the
              triggers. MFA on every sign-in; nothing releases by accident.
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-7">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">Access mode</div>
            <p className="mt-3 text-slate-300">
              Calm and guided. A recipient opens one scoped link and gets a prioritized, do-this-first
              plan — revealing only what they were granted, only once a release has actually happened.
            </p>
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Built on a correctness-first stack</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800 sm:grid-cols-2">
          {STACK.map((s) => (
            <div key={s.k} className="bg-slate-950 p-6">
              <div className="font-medium text-white">{s.k}</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Put a plan in place.</h2>
            <p className="mt-1 text-slate-400">It stays ARMED until you decide otherwise.</p>
          </div>
          <Link
            href="/auth/signin"
            className="rounded-md bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Owner sign in
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-semibold text-slate-300">Relay</span> — built for{' '}
            <span className="text-slate-400">H0: Hack the Zero Stack with Vercel and AWS Databases</span>.
          </div>
          <div className="flex items-center gap-5">
            <a
              href="https://github.com/sgharlow/relay"
              className="transition-colors hover:text-slate-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <span>MIT</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
