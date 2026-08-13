/**
 * The front door.
 *
 * This was the hackathon submission page: "Built on Amazon Aurora DSQL" in the
 * meta description, a stack section, ARMED→PENDING→GRACE→RELEASED badges, and
 * links to Devpost and GitHub. Correct for judges in June; wrong for the person
 * who types relaystandby.com in August, which is now the only kind of visitor
 * who arrives here — the ads land on /caregivers.
 *
 * Nothing was deleted. The architecture moved to /security, where a
 * security-minded buyer will actually look for it, and the hackathon artefacts
 * moved with it, where "independently judged and open to inspection" reads as
 * credibility rather than as "weekend project".
 *
 * This page now does one job: work out who arrived and send them somewhere
 * useful, without making them read a product pitch to find out whether they are
 * in the right place.
 *
 * Feature: relay-h0-mvp
 */

import Link from 'next/link';

import { PRICE_YEARLY_USD } from './caregivers/content';

const TITLE = 'Relay — standby access for the people who will need it';
const DESCRIPTION =
  'One encrypted vault for the accounts someone would need if you could not manage them. It opens when a real emergency is confirmed, and closes again when you recover.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'Relay', url: '/', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function Home() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-t5 font-semibold tracking-tight">Relay</span>
        <Link href="/auth/signin" className="text-t2 text-muted hover:text-paper">
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-12 sm:pt-20">
        <h1 className="font-serif text-t9 font-semibold leading-[1.06] tracking-tight">
          The accounts someone would need, if you could not manage them.
        </h1>
        <p className="mt-6 text-t5 leading-relaxed text-muted">
          Relay holds them encrypted, opens only what you chose for the person you chose, and only
          once a real emergency has been confirmed by someone you trust — then closes again when you
          recover. One price for the whole family, {`$${PRICE_YEARLY_USD}`} a year.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link
            href="/caregivers"
            className="rounded-md bg-ink px-6 py-3 text-t2 font-semibold text-paper transition-colors hover:bg-ink"
          >
            I&rsquo;m caring for a parent
          </Link>
          <Link
            href="/how-it-works"
            className="inline-flex min-h-[44px] items-center text-t2 font-medium text-muted underline decoration-rule-strong underline-offset-4 hover:text-paper"
          >
            Show me what actually happens
          </Link>
        </div>
      </section>

      {/* The three questions that decide whether someone reads on, answered in
          a line each rather than in a features grid. */}
      <section className="border-y border-rule bg-paper-sunken">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-14 sm:grid-cols-3">
          <div>
            <h2 className="text-t5 font-semibold text-ink">It closes again</h2>
            <p className="mt-2 text-t2 leading-relaxed text-muted">
              Every other way of doing this is a door you open once. Recover, check in, and access
              ends on its own — which is what makes it safe to set up before you need it.
            </p>
          </div>
          <div>
            <h2 className="text-t5 font-semibold text-ink">We cannot read it</h2>
            <p className="mt-2 text-t2 leading-relaxed text-muted">
              Secrets are encrypted in your browser before they reach us. We hold ciphertext, and we
              are honest on{' '}
              <Link href="/security" className="text-muted underline underline-offset-2">
                exactly what we can see
              </Link>
              .
            </p>
          </div>
          <div>
            <h2 className="text-t5 font-semibold text-ink">Someone has to say yes</h2>
            <p className="mt-2 text-t2 leading-relaxed text-muted">
              Nothing opens on a timer or a guess. A person you named confirms the situation is
              real, and never sees anything of yours.
            </p>
          </div>
        </div>
      </section>

      {/* Recipients arrive by email with a code, not through this page — but
          someone who was named and went looking should not hit a dead end. */}
      <section className="mx-auto max-w-3xl px-6 py-14">
        <h2 className="text-t5 font-semibold">Were you named by someone?</h2>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          If someone has asked you to be a recipient or a trusted contact, you will have an email
          with a code in it. Enter it at{' '}
          <Link href="/claim" className="text-ochre-text underline underline-offset-4">
            relaystandby.com/claim
          </Link>
          . Relay never sends a link that signs you in — if a message claiming to be from us asks
          you to click one, it is not from us.
        </p>
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 text-t2 text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="font-semibold text-muted">Relay</span> — standby access for the
            people who&rsquo;ll need it.
          </span>
          <div className="flex flex-wrap items-center gap-x-5">
            <Link href="/how-it-works" className="inline-flex min-h-[44px] items-center hover:text-muted">
              How it works
            </Link>
            {/* Help sits FIRST among the utility links, before the legal ones:
                somebody scanning a footer in difficulty is looking for a way to
                ask, not for Terms. */}
            <Link href="/help" className="inline-flex min-h-[44px] items-center hover:text-muted">
              Help
            </Link>
            <Link href="/security" className="inline-flex min-h-[44px] items-center hover:text-muted">
              Security
            </Link>
            <Link href="/privacy" className="inline-flex min-h-[44px] items-center hover:text-muted">
              Privacy
            </Link>
            <Link href="/terms" className="inline-flex min-h-[44px] items-center hover:text-muted">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
