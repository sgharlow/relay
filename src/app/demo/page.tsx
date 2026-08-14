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
import { caregiversHref } from '../caregivers/content';

export const metadata = {
  title: 'Relay — guided demo',
  description:
    'A read-only walkthrough of Relay: the vault, the zero-knowledge envelope, the ARMED → PENDING → GRACE → RELEASED state machine, and the hash-chained audit log.',
};

const stateChipClass = (state: string): string =>
  state === 'ARMED'
    ? 'border-sage bg-sage-soft text-sage-text'
    : state === 'RELEASED'
      ? 'border-ochre bg-ochre-soft text-ochre-text'
      : 'border-rule bg-paper-sunken text-muted';

const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;

export default function DemoTour() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-2">
          <Link href="/" className="text-t5 font-semibold tracking-tight hover:text-ink">
            Relay
          </Link>
          <span className="hidden text-t1 text-muted sm:inline">Guided demo</span>
        </div>
        <Link
          href="/auth/signin"
          className="rounded-md border border-rule px-4 py-2 text-t2 text-muted transition-colors hover:border-rule-strong"
        >
          Owner sign in
        </Link>
      </header>

      {/* Intro */}
      <section className="mx-auto max-w-5xl px-6 pb-4 pt-8">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-ochre bg-ochre-soft px-3 py-1 text-t1 text-ochre-text">
          🏆 Winner — Most Impactful · H0: Hack the Zero Stack with Vercel and AWS Databases
        </p>
        <h1 className="max-w-3xl font-serif text-t7 font-semibold tracking-tight">
          See what an owner sees.
        </h1>
        <p className="mt-4 max-w-2xl text-t5 leading-relaxed text-muted">
          A read-only tour with sample data — no account needed. Four stops: the vault, what the
          server actually stores, the release state machine, and the tamper-evident audit trail.
        </p>
        <p className="mt-3 inline-block rounded-md border border-rule bg-paper-sunken px-3 py-1.5 text-t1 text-muted">
          Demo environment with fictional sample data — nothing here is a real secret, and nothing
          you do on this page writes anywhere.
        </p>
        {/*
          🔴 THE TOUR ADVERTISED SOMETHING THE TERMS DISCLAIM, retargeted
          2026-08-12. Four of the eight sample items routed to an `estate`
          trigger — excluded from USER_SELECTABLE_TRIGGER_TYPES, permanently as
          of 2026-08-14 (`g2-counsel-opinion` declined), while /terms says Relay
          does not offer estate or inheritance services.

          The SAME contradiction was closed once already in /rules, which used to
          render its dropdown from the unfiltered list. The dropdown was fixed
          and this tour was not, so the funnel page went on selling it.

          Now a caregiver arc instead: an adult child managing a parent's
          affairs, which is both the wedge the product is sold on and a trigger a
          visitor can actually choose. The demo shows two recipients under two
          different triggers, which was the point of the estate arc — scoped
          access differs by person AND by condition — without offering anything
          that is not for sale.
        */}
      </section>

      {/* 1 — Vault */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="font-mono text-t2 text-ink">01 · The vault</div>
        <h2 className="mt-1 text-t5 font-semibold tracking-tight">
          Ranked by what matters in a crisis
        </h2>
        <p className="mt-2 max-w-2xl text-t2 leading-relaxed text-muted">
          The importance engine scores every item from metadata alone — it never sees a secret. The
          top of the list is almost always the primary email: the key that unlocks most password
          resets.
        </p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-rule">
          <table className="w-full min-w-[640px] text-left text-t2">
            <thead className="bg-paper-sunken text-t1 uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Importance</th>
                <th className="px-4 py-3 font-medium">Goes to</th>
                <th className="px-4 py-3 font-medium">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {DEMO_VAULT_ITEMS.map((item) => (
                <tr key={item.id} className="bg-paper-sunken">
                  <td className="px-4 py-3 text-muted">{item.name}</td>
                  <td className="px-4 py-3 text-muted">{item.category}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-sunken">
                        <div
                          className="h-full rounded-full bg-ink"
                          style={{ width: `${Math.round(item.importance * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-t1 text-muted">
                        {item.importance.toFixed(2)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{item.recipient}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-t1 ${
                        item.trigger === 'emergency'
                          ? 'border-rule-strong bg-paper-sunken text-ink'
                          : 'border-ochre bg-ochre-soft text-ochre-text'
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
      <section className="border-y border-rule bg-paper-sunken">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="font-mono text-t2 text-ink">02 · Zero-knowledge storage</div>
          <h2 className="mt-1 text-t5 font-semibold tracking-tight">
            This is everything the server has
          </h2>
          <p className="mt-2 max-w-2xl text-t2 leading-relaxed text-muted">
            Encryption happens in the browser: a per-item AES-GCM-256 data key encrypts the secret,
            then AWS KMS wraps that key. The row below is the complete server-side record for
            &ldquo;{DEMO_VAULT_ITEMS[0].name}&rdquo; — ciphertext is all there is to steal.
          </p>
          <div className="mt-6 rounded-xl border border-rule bg-paper p-6 font-mono text-t1 leading-relaxed">
            <div className="text-muted">algorithm</div>
            <div className="text-muted">{DEMO_ITEM_ENVELOPE.algorithm}</div>
            <div className="mt-3 text-muted">ciphertext</div>
            <div className="break-all text-muted">{DEMO_ITEM_ENVELOPE.ciphertext}</div>
            <div className="mt-3 text-muted">wrapped_data_key</div>
            <div className="break-all text-muted">{DEMO_ITEM_ENVELOPE.wrappedDataKey}</div>
            <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <div className="text-muted">iv</div>
                <div className="text-muted">{DEMO_ITEM_ENVELOPE.iv}</div>
              </div>
              <div>
                <div className="text-muted">kms_key</div>
                <div className="text-muted">{DEMO_ITEM_ENVELOPE.kmsKeyAlias}</div>
              </div>
            </div>
            <div className="mt-4 border-t border-rule pt-3 text-muted">
              stored columns:{' '}
              <span className="text-muted">{DEMO_ITEM_ENVELOPE.storedColumns.join(' · ')}</span>{' '}
              — <span className="text-sage-text">plaintext is not a column</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3 — State machine */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="font-mono text-t2 text-ink">03 · The release state machine</div>
        <h2 className="mt-1 text-t5 font-semibold tracking-tight">
          One verified emergency, step by step
        </h2>
        <p className="mt-2 max-w-2xl text-t2 leading-relaxed text-muted">
          Every transition is a strongly-consistent compare-and-set on Aurora DSQL — shown under
          each step. Owner, verifiers, and the scheduler can all act at once and the machine still
          advances exactly once. If retries ever exhaust, the row lands back in ARMED.
        </p>
        <ol className="mt-8 space-y-6">
          {DEMO_RELEASE_TIMELINE.map((step) => (
            <li key={step.state} className="rounded-xl border border-rule bg-paper-sunken p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-md border px-3 py-1.5 text-t1 font-medium tracking-wide ${stateChipClass(step.state)}`}
                >
                  {step.state}
                </span>
                <span className="font-mono text-t1 text-muted">{step.at}</span>
              </div>
              <h3 className="mt-3 font-semibold text-ink">{step.headline}</h3>
              <p className="mt-1 text-t2 leading-relaxed text-muted">{step.detail}</p>
              <div className="mt-3 overflow-x-auto rounded-md border border-rule bg-paper px-3 py-2 font-mono text-t1 text-muted">
                {step.cas}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4 — Audit chain */}
      <section className="border-y border-rule bg-paper-sunken">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="font-mono text-t2 text-ink">04 · The audit trail</div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mt-1 text-t5 font-semibold tracking-tight">
              Append-only, hash-chained, tamper-evident
            </h2>
            <span
              className={`mt-1 rounded-md border px-2.5 py-1 text-t1 font-medium ${
                DEMO_CHAIN_VERIFICATION.valid
                  ? 'border-sage bg-sage-soft text-sage-text'
                  : 'border-clay bg-clay-soft text-clay'
              }`}
            >
              {DEMO_CHAIN_VERIFICATION.valid ? '✓ chain intact' : '✗ chain broken'}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-t2 leading-relaxed text-muted">
            Each entry&rsquo;s hash is SHA-256 of the previous hash plus the entry itself, anchored
            at a genesis of 64 zeros. This chain isn&rsquo;t an illustration — it&rsquo;s computed
            and verified by the same code that runs in production. Edit any line and the chip above
            flips red.
          </p>
          <div className="mt-6 space-y-2">
            {DEMO_AUDIT_CHAIN.map((entry) => (
              <div
                key={entry.seq}
                className="flex flex-col gap-1 rounded-lg border border-rule bg-paper-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-t1 text-muted">#{entry.seq}</span>
                  <div>
                    <span className="font-mono text-t1 text-ink">{entry.event_type}</span>
                    <span className="ml-2 text-t1 text-muted">{entry.actor}</span>
                    <div className="text-t2 text-muted">{entry.detail}</div>
                  </div>
                </div>
                <div className="font-mono text-[11px] text-muted sm:text-right">
                  <div>{shortHash(entry.prev_hash)} →</div>
                  <div className="text-muted">{shortHash(entry.entry_hash)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Caregiver wedge — self-qualifying, so only the real audience clicks through */}
      <section className="mx-auto max-w-5xl px-6 pt-14">
        <div className="rounded-2xl border border-ochre bg-ochre-soft p-8">
          <h2 className="text-t5 font-semibold tracking-tight text-ochre-text">
            Caring for an aging parent right now?
          </h2>
          <p className="mt-2 max-w-2xl text-t2 leading-relaxed text-muted">
            Everything above was built for one moment in particular: the call comes, and suddenly you
            need their bank, their insurance portal, their email — and you need that access to end
            when the crisis does.
          </p>
          <Link
            href={caregiversHref('h0-demo')}
            className="mt-5 inline-block rounded-md bg-ink px-5 py-2.5 text-t2 font-semibold text-paper transition-colors hover:bg-ink"
          >
            See Relay for caregivers →
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-14">
        <h2 className="text-t5 font-semibold tracking-tight">Want the full story?</h2>
        <p className="mt-1 text-muted">
          Two minutes of video shows the live system doing everything above — including a
          multi-region failover.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-t2">
          <a
            href="https://youtu.be/FU3azKJOesY"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-ink px-5 py-3 font-medium text-paper transition-colors hover:bg-ink"
          >
            Watch the demo video
          </a>
          <a
            href="https://devpost.com/software/relay-n5c9re"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-rule px-5 py-3 text-muted transition-colors hover:border-rule-strong"
          >
            Devpost submission
          </a>
          <a
            href="https://github.com/sgharlow/relay"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-rule px-5 py-3 text-muted transition-colors hover:border-rule-strong"
          >
            Source on GitHub
          </a>
          <Link href="/" className="px-2 py-3 text-muted transition-colors hover:text-muted">
            ← Back to the front page
          </Link>
        </div>
      </section>
    </main>
  );
}
