/**
 * Public read-only guided demo (/demo) — the post-win showcase.
 *
 * No auth, no DB, no writes: everything renders from lib/demo-tour/fixtures.
 * The audit chain shown in section 4 is a real SHA-256 hash chain computed and
 * verified with the production primitives (lib/audit/chain.ts) — its "intact"
 * chip is the actual verifier result, not a decoration.
 *
 * Feature: relay-h0-mvp (demo tour)
 */

import Link from 'next/link';
import {
  DEMO_AUDIT_CHAIN,
  DEMO_CHAIN_VERIFICATION,
  DEMO_ITEM_ENVELOPE,
  DEMO_RELEASE_TIMELINE,
  DEMO_VAULT_ITEMS,
} from '../../../lib/demo-tour/fixtures';

export const metadata = {
  title: 'Relay — guided demo',
  description:
    'A read-only walkthrough of Relay: the vault, the zero-knowledge envelope, the ARMED → PENDING → GRACE → RELEASED state machine, and the hash-chained audit log.',
};

const stateChipClass = (state: string): string =>
  state === 'ARMED'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : state === 'RELEASED'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-slate-700 bg-slate-900/60 text-slate-300';

const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;

export default function DemoTour() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2">
          <Link href="/" className="text-lg font-semibold tracking-tight hover:text-blue-300">
            Relay
          </Link>
          <span className="hidden text-xs text-slate-400 sm:inline">Guided demo</span>
        </div>
        <Link
          href="/auth/signin"
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500"
        >
          Owner sign in
        </Link>
      </header>

      {/* Intro */}
      <section className="mx-auto max-w-5xl px-6 pb-4 pt-8">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
          🏆 Winner — Most Impactful · H0: Hack the Zero Stack with Vercel and AWS Databases
        </p>
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
          See what an owner sees.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-300">
          A read-only tour with sample data — no account needed. Four stops: the vault, what the
          server actually stores, the release state machine, and the tamper-evident audit trail.
        </p>
        <p className="mt-3 inline-block rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-400">
          Demo environment with fictional sample data — nothing here is a real secret, and nothing
          you do on this page writes anywhere.
        </p>
      </section>

      {/* 1 — Vault */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="font-mono text-sm text-blue-400">01 · The vault</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          Ranked by what matters in a crisis
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          The importance engine scores every item from metadata alone — it never sees a secret. The
          top of the list is almost always the primary email: the key that unlocks most password
          resets.
        </p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Importance</th>
                <th className="px-4 py-3 font-medium">Goes to</th>
                <th className="px-4 py-3 font-medium">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {DEMO_VAULT_ITEMS.map((item) => (
                <tr key={item.id} className="bg-slate-950/60">
                  <td className="px-4 py-3 text-slate-200">{item.name}</td>
                  <td className="px-4 py-3 text-slate-400">{item.category}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.round(item.importance * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-slate-400">
                        {item.importance.toFixed(2)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{item.recipient}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs ${
                        item.trigger === 'emergency'
                          ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      {item.trigger}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2 — Envelope */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="font-mono text-sm text-blue-400">02 · Zero-knowledge storage</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            This is everything the server has
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Encryption happens in the browser: a per-item AES-GCM-256 data key encrypts the secret,
            then AWS KMS wraps that key. The row below is the complete server-side record for
            &ldquo;{DEMO_VAULT_ITEMS[0].name}&rdquo; — ciphertext is all there is to steal.
          </p>
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-6 font-mono text-xs leading-relaxed">
            <div className="text-slate-500">algorithm</div>
            <div className="text-slate-200">{DEMO_ITEM_ENVELOPE.algorithm}</div>
            <div className="mt-3 text-slate-500">ciphertext</div>
            <div className="break-all text-slate-300">{DEMO_ITEM_ENVELOPE.ciphertext}</div>
            <div className="mt-3 text-slate-500">wrapped_data_key</div>
            <div className="break-all text-slate-300">{DEMO_ITEM_ENVELOPE.wrappedDataKey}</div>
            <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <div className="text-slate-500">iv</div>
                <div className="text-slate-300">{DEMO_ITEM_ENVELOPE.iv}</div>
              </div>
              <div>
                <div className="text-slate-500">kms_key</div>
                <div className="text-slate-300">{DEMO_ITEM_ENVELOPE.kmsKeyAlias}</div>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-800 pt-3 text-slate-500">
              stored columns:{' '}
              <span className="text-slate-300">{DEMO_ITEM_ENVELOPE.storedColumns.join(' · ')}</span>{' '}
              — <span className="text-emerald-300">plaintext is not a column</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3 — State machine */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="font-mono text-sm text-blue-400">03 · The release state machine</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          One verified emergency, step by step
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Every transition is a strongly-consistent compare-and-set on Aurora DSQL — shown under
          each step. Owner, verifiers, and the scheduler can all act at once and the machine still
          advances exactly once. If retries ever exhaust, the row lands back in ARMED.
        </p>
        <ol className="mt-8 space-y-6">
          {DEMO_RELEASE_TIMELINE.map((step) => (
            <li key={step.state} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium tracking-wide ${stateChipClass(step.state)}`}
                >
                  {step.state}
                </span>
                <span className="font-mono text-xs text-slate-500">{step.at}</span>
              </div>
              <h3 className="mt-3 font-semibold text-slate-100">{step.headline}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{step.detail}</p>
              <div className="mt-3 overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-400">
                {step.cas}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4 — Audit chain */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="font-mono text-sm text-blue-400">04 · The audit trail</div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Append-only, hash-chained, tamper-evident
            </h2>
            <span
              className={`mt-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
                DEMO_CHAIN_VERIFICATION.valid
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              }`}
            >
              {DEMO_CHAIN_VERIFICATION.valid ? '✓ chain intact' : '✗ chain broken'}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Each entry&rsquo;s hash is SHA-256 of the previous hash plus the entry itself, anchored
            at a genesis of 64 zeros. This chain isn&rsquo;t an illustration — it&rsquo;s computed
            and verified by the same code that runs in production. Edit any line and the chip above
            flips red.
          </p>
          <div className="mt-6 space-y-2">
            {DEMO_AUDIT_CHAIN.map((entry) => (
              <div
                key={entry.seq}
                className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-slate-600">#{entry.seq}</span>
                  <div>
                    <span className="font-mono text-xs text-blue-300">{entry.event_type}</span>
                    <span className="ml-2 text-xs text-slate-500">{entry.actor}</span>
                    <div className="text-sm text-slate-300">{entry.detail}</div>
                  </div>
                </div>
                <div className="font-mono text-[11px] text-slate-600 sm:text-right">
                  <div>{shortHash(entry.prev_hash)} →</div>
                  <div className="text-slate-500">{shortHash(entry.entry_hash)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-14">
        <h2 className="text-2xl font-semibold tracking-tight">Want the full story?</h2>
        <p className="mt-1 text-slate-400">
          Two minutes of video shows the live system doing everything above — including a
          multi-region failover.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <a
            href="https://youtu.be/FU3azKJOesY"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-blue-600 px-5 py-3 font-medium text-white transition-colors hover:bg-blue-500"
          >
            Watch the demo video
          </a>
          <a
            href="https://devpost.com/software/relay-n5c9re"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-slate-700 px-5 py-3 text-slate-300 transition-colors hover:border-slate-500"
          >
            Devpost submission
          </a>
          <a
            href="https://github.com/sgharlow/relay"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-slate-700 px-5 py-3 text-slate-300 transition-colors hover:border-slate-500"
          >
            Source on GitHub
          </a>
          <Link href="/" className="px-2 py-3 text-slate-400 transition-colors hover:text-slate-200">
            ← Back to the front page
          </Link>
        </div>
      </section>
    </main>
  );
}
