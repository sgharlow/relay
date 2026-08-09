/**
 * /security — what protects this, for the two people who ask.
 *
 * The technical content used to live on the site's front door, aimed at
 * hackathon judges. It is kept — deliberately, because it is real and it is
 * evidence — but re-aimed, and the ordering is the whole point.
 *
 * TWO READERS, and the commercially important one is not the developer. First
 * is a caregiver about to put their mother's bank login into a website run by
 * someone they have never heard of; their question is "can you read this?" and
 * it is a purchase blocker, not a curiosity. Second is a developer or a
 * security-minded buyer who wants the mechanism. The first reader gets plain
 * answers at the top; the second gets the architecture below, where it does not
 * tax anyone who did not come for it.
 *
 * The hackathon artefacts (Devpost, the public repo) live here rather than on
 * the front door. In this context "independently judged, and open to
 * inspection" is an asset; on a landing page it frames a credential vault as a
 * weekend project.
 *
 * Feature: relay-h0-mvp
 */

import Link from 'next/link';

const TITLE = 'Security — what protects your vault';
const DESCRIPTION =
  'Plain answers first: what Relay can and cannot read, what happens if we are breached, and what happens if we disappear. Then the architecture, for people who want it.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/security' },
  openGraph: { type: 'website', siteName: 'Relay', url: '/security', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/** The questions people actually ask, answered without hedging. */
const PLAIN_ANSWERS = [
  {
    q: 'Can you read my mother’s passwords?',
    a: 'No. Every secret is encrypted in your browser before it is sent, with a key we never receive in usable form. Our servers hold ciphertext and a copy of that key wrapped by AWS KMS. We can prove we hold your data; we cannot show you what is in it.',
  },
  {
    q: 'What can you read, then?',
    a: 'The labels. The item title, the service name, the web address, the category, and who you have designated. So we can tell that you store a Chase account — we cannot tell you anything about it. If the existence of an account is itself sensitive, do not label it accurately.',
  },
  {
    q: 'What happens if you get breached?',
    a: 'An attacker with our database gets ciphertext and wrapped keys, not credentials. Unwrapping requires AWS KMS to authorise it for an authenticated session, which a stolen database does not provide.',
  },
  {
    q: 'What happens if Relay disappears?',
    a: 'You can export everything, decrypted in your browser, from your account page at any time — not on request, and not only if we are still around to answer. Keep that file the way you would keep a password list.',
  },
  {
    q: 'Can someone trick you into opening my vault?',
    a: 'Releasing requires the trigger you configured AND confirmation from the people you named. Relay never sends a link that signs anyone in — every message asks for a code typed at our address — so a convincing email cannot, by itself, open anything.',
  },
  {
    q: 'What if I lose my phone?',
    a: 'You get recovery codes when you create the vault. One of them enrols a new authenticator. Losing the phone costs you your sign-in, not your data — but lose the codes too and nobody can let you in, including us.',
  },
];

/** The mechanism, for the reader who wants it. Unchanged in substance from the original build. */
const ARCHITECTURE = [
  {
    k: 'Client-side envelope encryption',
    v: 'A per-item AES-GCM-256 data key is generated in the browser via SubtleCrypto, used to encrypt the secret, then wrapped by an AWS KMS customer master key. The server stores ciphertext plus the wrapped key and never handles the plaintext data key.',
  },
  {
    k: 'A release state machine, not a share button',
    v: 'ARMED → PENDING → GRACE → RELEASED, with exactly seven permitted transitions. Each one is a compare-and-set against a strongly-consistent store, so an owner, a verifier and the scheduler acting at the same moment cannot double-release. Exhausting a retry always lands back in ARMED — the safe state is the default, not the exception.',
  },
  {
    k: 'Reversibility as a property of the trigger',
    v: 'Whether a release can be undone is derived from the trigger type rather than a flag someone could set wrongly. Emergencies reverse; estate handoffs are permanent by construction.',
  },
  {
    k: 'Hash-chained audit log',
    v: 'Every access, grant and release is an append-only entry whose hash includes the previous entry’s. Editing history is detectable, and the chain is verifiable in your own browser rather than on our word. A failed audit write blocks the operation it was recording.',
  },
  {
    k: 'Zero-knowledge boundary for the ranking',
    v: 'The component that works out which credentials unlock the others reads labels only. It is structurally prevented from decrypting anything, so the analysis that makes the product useful cannot become the thing that exposes you.',
  },
  {
    k: 'Aurora DSQL, active-active across regions',
    v: 'The correctness invariant is owned by the database rather than reconstructed in application code, and the data survives the loss of a region.',
  },
];

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-white text-slate-800">
      <header className="mx-auto max-w-3xl px-6 pb-2 pt-14">
        <Link href="/caregivers" style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
          ← Relay for caregivers
        </Link>
        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900">
          What protects your vault
        </h1>
        <p className="mt-4 text-[19px] leading-relaxed text-slate-700">
          You are considering putting a parent&rsquo;s bank login into a website you had not heard
          of last week. These are the questions that deserve straight answers.
        </p>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        <dl className="space-y-8">
          {PLAIN_ANSWERS.map((item) => (
            <div key={item.q}>
              <dt className="text-xl font-semibold text-slate-900">{item.q}</dt>
              <dd className="mt-2 text-[17px] leading-relaxed text-slate-700">{item.a}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-10 rounded-xl border border-slate-300 bg-slate-50 p-5 text-[16px] leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-900">One thing we will not claim.</span> Relay
          is early-stage software with no paying customers yet. The engineering above is real and
          you can inspect it, but a young product is a young product — please do not make this the
          only place something important is written down. Our{' '}
          <Link href="/terms" className="text-blue-700 underline">
            terms
          </Link>{' '}
          say the same thing.
        </p>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">How it is built</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
            For readers who want the mechanism rather than the reassurance.
          </p>
          <dl className="mt-8 space-y-6">
            {ARCHITECTURE.map((a) => (
              <div key={a.k} className="border-l-2 border-slate-300 pl-4">
                <dt className="font-semibold text-slate-900">{a.k}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-slate-600">{a.v}</dd>
              </div>
            ))}
          </dl>

          {/* Here rather than on the front door: in this context it reads as
              "independently judged, open to inspection"; on a landing page it
              frames a credential vault as a weekend project. */}
          <div className="mt-10 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[15px] leading-relaxed text-slate-700">
              Relay won <span className="font-semibold">Most Impactful</span> at the H0 hackathon,
              judged on this architecture. The build is public and open to inspection.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-[15px]">
              <a
                href="https://github.com/sgharlow/relay"
                className="text-blue-700 underline"
                rel="noreferrer"
                target="_blank"
              >
                Source code
              </a>
              <a
                href="https://devpost.com/software/relay-n5c9re"
                className="text-blue-700 underline"
                rel="noreferrer"
                target="_blank"
              >
                Submission and judging
              </a>
              <Link href="/demo" className="text-blue-700 underline">
                Guided demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="text-[19px] leading-relaxed text-slate-800">
          Still deciding? The clearest way to judge it is to see what happens.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/how-it-works"
            className="inline-flex min-h-[48px] items-center rounded-md border border-slate-300 px-5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            How it works
          </Link>
          <Link
            href="/caregivers"
            className="inline-flex min-h-[48px] items-center rounded-md bg-amber-500 px-6 text-sm font-semibold text-slate-950 hover:bg-amber-400"
          >
            Relay for caregivers
          </Link>
        </div>
      </section>
    </main>
  );
}
