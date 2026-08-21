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
        {/*
          🔴 TWO DEFECTS IN ONE LINE, BOTH FOUND ON PRODUCTION AT 390px.

          It had no padding, so its tap target was the height of the text — 22px
          — on the landing page's only control, which is the first thing a
          returning owner reaches for on a phone. `data-target="control"` is the
          hook globals.css already carries for exactly this: a link that behaves
          as a control rather than as prose, so it takes the 44px touch floor
          while inline links in sentences correctly do not.

          And `hover:text-paper` painted it --paper on a --paper background —
          the link VANISHED under the cursor. Almost certainly meant to pair
          with the dark rail, where paper-on-ink is right; here it is
          invisible-on-invisible. --ink is the hover this palette wants: muted
          text darkening to full ink on approach.
        */}
        <Link
          href="/auth/signin"
          data-target="control"
          className="-mr-2 px-2 text-t2 text-muted hover:text-ink"
        >
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
            className="inline-flex min-h-[44px] items-center text-t2 font-medium text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink"
          >
            Show me what actually happens
          </Link>
        </div>

        {/*
          THE HERO IMAGE SITS BELOW THE WORDS, NOT BESIDE THEM. This page has to
          survive at 390px, and a side-by-side hero at that width becomes a
          thumbnail nobody can read next to a paragraph nobody can either.

          Decorative, so `alt=""`: everything it says is already said above it in
          text. Its own <title>/<desc> stay in the file for anything that opens
          it directly. Loaded as an <img> rather than inlined so that no colour
          literal enters this file — see lib/ops/raw-color.test.ts, which treats
          a new hex in a page as a defect.
        */}
        <img
          src="/assets/illustration/circle-of-trust.svg"
          alt=""
          width={1100}
          height={372}
          className="mt-12 h-auto w-full"
        />
      </section>

      {/* The three questions that decide whether someone reads on, answered in
          a line each rather than in a features grid. */}
      <section className="border-y border-rule bg-paper-sunken">
        {/*
          ONE DRAWING PER CLAIM, and each one drawn for THAT claim rather than
          chosen from a pile afterwards: the return arc for reversibility, the
          key that stays on your device for the encryption boundary, the ring of
          seats for the quorum. A uniform 64px height with the widths left to
          fall where they will — these are small illustrations, not icons, and
          forcing them into equal boxes would crop the only one that needs its
          horizontal room (a device on the left, storage on the right).
        */}
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-14 sm:grid-cols-3">
          <div>
            <img
              src="/assets/illustration/reversible.svg"
              alt=""
              width={160}
              height={160}
              className="mb-4 h-16 w-auto"
            />
            <h2 className="text-t5 font-semibold text-ink">It closes again</h2>
            <p className="mt-2 text-t2 leading-relaxed text-muted">
              Every other way of doing this is a door you open once. Recover, check in, and access
              ends on its own — which is what makes it safe to set up before you need it.
            </p>
          </div>
          <div>
            <img
              src="/assets/illustration/key-stays-with-you.svg"
              alt=""
              width={420}
              height={150}
              className="mb-4 h-16 w-auto"
            />
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
            {/*
              The SMALL cut, not the full ring. The explainer version carries a
              centre vault, a progress arc and dashed empty seats, all of which
              collapse into speckle at 64px — verified by rendering it, not by
              assuming. This one keeps only the fact worth reading at a glance:
              how many have said yes.
            */}
            <img
              src="/assets/illustration/quorum-mark.svg"
              alt=""
              width={100}
              height={100}
              className="mb-4 h-16 w-auto"
            />
            <h2 className="text-t5 font-semibold text-ink">Someone has to say yes</h2>
            <p className="mt-2 text-t2 leading-relaxed text-muted">
              Nothing opens on a timer or a guess. A person you named confirms the situation is
              real, and never sees anything of yours.
            </p>
          </div>
        </div>
      </section>

      {/* Someone who was named and went looking should not hit a dead end.

          🔴 THIS PARAGRAPH USED TO SAY "you will have an email with a code in
          it" — was: the exact assertion /claim was corrected for on 2026-08-16,
          made one screen earlier. `BETA_INVITE_CHANNEL = 'owner'`
          (lib/people/invite.ts) is the arm the product DEFAULTS to and it "sends
          nothing at all and hands the owner a code to read out". So a daughter
          who was read her code down the phone was told by the front page to look
          for a message nobody sent, decided she had missed it, and stopped.
          `lib/ops/claim-copy.test.ts` was written to stop precisely this and its
          file list was one file, so it never looked here. page.test.ts does.

          The page cannot know which arm the owner used, so it asserts neither. */}
      <section className="mx-auto max-w-3xl px-6 py-14">
        <h2 className="text-t5 font-semibold">Were you named by someone?</h2>
        <p className="mt-2 text-t2 leading-relaxed text-muted">
          If someone has asked you to be a recipient or a trusted contact, they will have given you
          a code &mdash; they may have read it out, texted it, or written it down. Enter it at{' '}
          <Link href="/claim" className="text-ochre-text underline underline-offset-4">
            relaystandby.com/claim
          </Link>
          . A real message from Relay never asks you to click a link and then enter anything — if a
          message claiming to be from us does, it is not from us.
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
            {/* Beside Help for the same reason. A plain <a>, not <Link>: the
                guide is a static file under public/, not a route, so Next's
                client router has nothing to prefetch or push. */}
            <a href="/guide" className="inline-flex min-h-[44px] items-center hover:text-muted">
              Guide
            </a>
            {/*
              /about sits FIRST among the trust links, deliberately. It is the
              one a reader from an op-ed goes looking for — "who is asking me to
              store my mother's passwords" — and until 2026-08-16 there was no
              answer to that question anywhere on the site.
            */}
            <Link href="/about" className="inline-flex min-h-[44px] items-center hover:text-muted">
              About
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
            {/* The A2P opt-in URL. Footer-linked as well as in the sitemap,
                because a carrier reviewer checks that it is reachable from the
                site rather than only that the URL resolves. */}
            <Link href="/sms" className="inline-flex min-h-[44px] items-center hover:text-muted">
              Texts
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
