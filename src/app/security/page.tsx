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
    /*
      Added 2026-08-14 with the Terms change, and placed FIRST deliberately. It
      is the behaviour a reader is most likely to guess wrong about, and the one
      the Terms previously implied the opposite of. A security page that
      describes the crypto in detail and stays quiet about what happens when the
      owner never returns is answering the easy question.
    */
    k: 'A release does not expire on its own',
    v: 'Access opens when the conditions the owner set are met — including their check-ins stopping — and closes when they check in or stand it down. Nothing closes it automatically. If an owner never returns, what was opened stays open to the people they named, and what was never scoped to anybody stays shut. Relay does not offer estate or inheritance services and confers no legal authority on anyone; recipients are told so, once, before they see anything, and the acknowledgement is written to the owner’s audit log.',
  },
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
    <main className="min-h-screen bg-paper-raised text-ink">
      <header className="mx-auto max-w-3xl px-6 pb-2 pt-14">
        <Link href="/caregivers" style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
          ← Relay for caregivers
        </Link>
        <h1 className="mt-4 font-serif text-t9 font-semibold leading-tight tracking-tight text-ink">
          What protects your vault
        </h1>
        <p className="mt-4 text-[19px] leading-relaxed text-ink">
          You are considering putting a parent&rsquo;s bank login into a website you had not heard
          of last week. These are the questions that deserve straight answers.
        </p>

        {/*
          THE TWO CLAIMS THIS PAGE EXISTS TO MAKE, BEFORE THE PROSE.

          "Encrypted client-side with an envelope-wrapped data key" is a wall to
          the person this page is written for. Drawn as possession it needs no
          vocabulary at all: the key is on the left, in your hand, and the space
          where a second one would be on the right is EMPTY.

          Beside it, the anti-phishing promise — an envelope carrying four
          characters and nothing else. Both are the assurance-by-absence device
          the hero uses, which is why they belong together and above the words.
        */}
        <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
          <img
            src="/assets/illustration/key-stays-with-you.svg"
            alt=""
            width={420}
            height={150}
            className="h-auto w-full max-w-sm"
          />
          <img
            src="/assets/illustration/no-sign-in-links.svg"
            alt=""
            width={260}
            height={160}
            className="h-auto w-full max-w-[13rem]"
          />
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        <dl className="space-y-8">
          {PLAIN_ANSWERS.map((item) => (
            <div key={item.q}>
              <dt className="text-t5 font-semibold text-ink">{item.q}</dt>
              <dd className="mt-2 text-[17px] leading-relaxed text-ink">{item.a}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-10 rounded-xl border border-rule-strong bg-paper-sunken p-5 text-[16px] leading-relaxed text-ink">
          <span className="font-semibold text-ink">One thing we will not claim.</span> Relay
          is early-stage software with no paying customers yet. The engineering above is real and
          you can inspect it, but a young product is a young product — please do not make this the
          only place something important is written down. Our{' '}
          <Link href="/terms" className="text-ink underline">
            terms
          </Link>{' '}
          say the same thing.
        </p>
      </section>

      <section className="border-y border-rule bg-paper-sunken">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="text-t5 font-semibold tracking-tight text-ink">How it is built</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-muted">
            For readers who want the mechanism rather than the reassurance.
          </p>
          <dl className="mt-8 space-y-6">
            {ARCHITECTURE.map((a) => (
              <div key={a.k} className="border-l-2 border-rule-strong pl-4">
                <dt className="font-semibold text-ink">{a.k}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-muted">{a.v}</dd>
              </div>
            ))}
          </dl>

          {/* Here rather than on the front door: in this context it reads as
              "independently judged, open to inspection"; on a landing page it
              frames a credential vault as a weekend project. */}
          <div className="mt-10 rounded-xl border border-rule bg-paper-raised p-5">
            <p className="text-[15px] leading-relaxed text-ink">
              Relay won <span className="font-semibold">Most Impactful</span> at the H0 hackathon,
              judged on this architecture. The build is public and open to inspection.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-[15px]">
              <a
                href="https://github.com/sgharlow/relay"
                className="text-ink underline"
                rel="noreferrer"
                target="_blank"
              >
                Source code
              </a>
              <a
                href="https://devpost.com/software/relay-n5c9re"
                className="text-ink underline"
                rel="noreferrer"
                target="_blank"
              >
                Submission and judging
              </a>
              <Link href="/demo" className="text-ink underline">
                Guided demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="text-[19px] leading-relaxed text-ink">
          Still deciding? The clearest way to judge it is to see what happens.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/how-it-works"
            className="inline-flex min-h-[48px] items-center rounded-md border border-rule-strong px-5 text-t2 font-medium text-ink hover:bg-paper-sunken"
          >
            How it works
          </Link>
          <Link
            href="/caregivers"
            className="inline-flex min-h-[48px] items-center rounded-md bg-ink px-6 text-t2 font-semibold text-paper hover:bg-ink"
          >
            Relay for caregivers
          </Link>
        </div>
      </section>
    </main>
  );
}
