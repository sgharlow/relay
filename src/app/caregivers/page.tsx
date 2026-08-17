/**
 * G1 caregiver-wedge landing — the willingness-to-pay test instrument.
 *
 * Gate g1-caregiver-wtp (PROJECT.yaml): >=2% click-to-intent at a real price,
 * N>=100 qualified visitors; kill <0.5%. The intent event is a click-through to
 * /caregivers/interest with the price already shown. Copy leads with
 * REVERSIBILITY per docs/COMPETITORS.md.
 *
 * DRAWN ON THE SYSTEM (2026-08-09). This page used to be near-black with gold
 * accents and a blurred glow, while everything after it — signup, start, vault —
 * is paper and ink. A paid click therefore crossed a visual seam at exactly the
 * moment it was deciding whether to trust us, and arrived somewhere that looked
 * like a different company. The copy was never the problem and is unchanged.
 *
 * Colour does one job each: ink carries text and every primary action, ochre
 * marks the one argument that matters — that access closes itself — and clay
 * appears nowhere on this page, because nothing here is permanent. Reserving it
 * is what lets it mean something on the estate row later.
 *
 * No glow, no gradient, no glass. Decoration reads as marketing, and marketing
 * on a page asking for a parent's passwords reads as a phishing attempt.
 *
 * Feature: relay-g1-wtp
 */

import Link from 'next/link';

import {
  CTA_LABEL,
  WINNER_BADGE,
  SECONDARY_CTA_LABEL,
  productHref,
  DIFFERENTIATORS,
  HEADLINE,
  intentHref,
  OG_DESCRIPTION,
  OG_TITLE,
  PRICE_YEARLY_USD,
  SUBHEAD,
  TRUST_POINTS,
} from './content';
import { GUARANTEE_LABEL } from '../../../lib/offer';
import QualifiedTracker from './QualifiedTracker';

/**
 * openGraph is set explicitly rather than inherited. The root layout's OG copy
 * describes the platform ("living-continuity vault — reversible emergency
 * access, permanent estate handoff"), which is category jargon; a caregiver who
 * sees this link shared, or an ad reviewer who crawls it, should get the
 * caregiver message the page itself leads with.
 */
export const metadata = {
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  alternates: { canonical: '/caregivers' },
  openGraph: {
    type: 'website',
    siteName: 'Relay',
    url: '/caregivers',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
};

const wrap = 'mx-auto w-full';
const wrapStyle: React.CSSProperties = { maxWidth: '1080px', padding: '0 var(--s6)' };

/** Ink, because a primary action is not decoration. */
const primaryCta: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '48px',
  padding: 'var(--s3) var(--s6)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 'var(--t3)',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
  padding: 'var(--s6)',
};

const sectionHeading: React.CSSProperties = {
  fontFamily: 'var(--font-read)',
  fontSize: 'var(--t7)',
  fontWeight: 500,
  letterSpacing: '-0.01em',
  textWrap: 'balance',
};

export default function CaregiversLanding() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)' }}>
      <QualifiedTracker />

      <header
        className={`${wrap} flex items-center justify-between`}
        style={{ ...wrapStyle, paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}
      >
        <div className="flex items-baseline" style={{ gap: 'var(--s2)' }}>
          <span style={{ fontSize: 'var(--t5)', fontWeight: 600, letterSpacing: '-0.01em' }}>Relay</span>
          <span className="hidden sm:inline" style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
            for the ones who step in
          </span>
        </div>
        <Link href={intentHref('nav')} style={{ ...primaryCta, minHeight: '44px', padding: 'var(--s2) var(--s4)', fontSize: 'var(--t2)' }}>
          Get started
        </Link>
      </header>

      {/* Hero */}
      <section style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className={wrap} style={{ ...wrapStyle, paddingTop: 'var(--s12)', paddingBottom: 'var(--s12)' }}>
          <div className="flex flex-wrap" style={{ gap: 'var(--s2)' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--s2)',
                borderRadius: '999px',
                border: '1px solid var(--rule-strong)',
                padding: '4px 12px',
                fontSize: 'var(--t1)',
                color: 'var(--ink-muted)',
              }}
            >
              For adult children caring for aging parents
            </span>

            {/* H0 win — distribution ammunition per the disposition plan's WIN branch. */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '999px',
                border: '1px solid var(--ochre)',
                padding: '4px 12px',
                fontSize: 'var(--t1)',
                fontWeight: 500,
                color: 'var(--ochre-text)',
              }}
            >
              {WINNER_BADGE}
            </span>
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-read)',
              fontSize: 'var(--t9)',
              fontWeight: 600,
              lineHeight: 1.06,
              letterSpacing: '-0.02em',
              margin: 'var(--s6) 0 0',
              maxWidth: '20ch',
              textWrap: 'balance',
            }}
          >
            {HEADLINE}
          </h1>

          <p style={{ fontSize: 'var(--t5)', lineHeight: 1.55, color: 'var(--ink-muted)', marginTop: 'var(--s6)', maxWidth: '62ch' }}>
            {SUBHEAD}
          </p>

          <div className="flex flex-wrap items-center" style={{ gap: 'var(--s4)', marginTop: 'var(--s8)' }}>
            <Link href={intentHref('hero')} style={primaryCta}>
              {CTA_LABEL}
            </Link>
            <span style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
              One price, the whole family. Cancel anytime.
            </span>
          </div>

          {/* Secondary lane: the product funnel. Measures WTP after the reveal
              rather than from copy alone. Does not split the gate — a conversion
              here still reaches /caregivers/interest and fires caregiver_intent. */}
          <div style={{ marginTop: 'var(--s4)' }}>
            <Link
              href={productHref('hero-product')}
              className="inline-flex min-h-[44px] items-center"
              style={{ fontSize: 'var(--t2)', fontWeight: 500, color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '4px' }}
            >
              {SECONDARY_CTA_LABEL}
            </Link>
          </div>
        </div>
      </section>

      {/* The moment it's for */}
      <section className={wrap} style={{ ...wrapStyle, paddingTop: 'var(--s12)', paddingBottom: 'var(--s12)' }}>
        <div style={{ maxWidth: '68ch' }}>
          <h2 style={sectionHeading}>The call comes. Then the lockouts start.</h2>
          <p style={{ fontSize: 'var(--t3)', lineHeight: 1.65, marginTop: 'var(--s4)' }}>
            The bank. The insurance portal. The pharmacy account. The email that resets all of them.
            Most families solve this ahead of time the only way they know how — by handing over
            every password to everyone, forever. That works right up until it doesn&apos;t, and it
            can never be undone.
          </p>
          <p style={{ fontSize: 'var(--t3)', lineHeight: 1.65, marginTop: 'var(--s4)' }}>
            Relay is the other way: a vault your parent controls while they can, that opens{' '}
            <strong style={{ fontWeight: 600 }}>only what each person needs, only when a real trigger fires</strong>{' '}
            — and that{' '}
            {/* The one thing in ochre on this page. It is the argument. */}
            <span style={{ color: 'var(--ochre-text)', fontWeight: 600 }}>closes itself when they recover</span>.
          </p>
        </div>
      </section>

      {/* Differentiators */}
      <section style={{ borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', background: 'var(--paper-sunken)' }}>
        <div className={wrap} style={{ ...wrapStyle, paddingTop: 'var(--s12)', paddingBottom: 'var(--s12)' }}>
          <h2 style={sectionHeading}>Why not the alternatives you&apos;ve already considered?</h2>
          <div className="grid lg:grid-cols-3" style={{ gap: 'var(--s6)', marginTop: 'var(--s8)' }}>
            {DIFFERENTIATORS.map((d) => (
              <div key={d.them} style={card}>
                <div style={{ fontSize: 'var(--t3)', fontWeight: 600 }}>{d.them}</div>
                <p style={{ fontSize: 'var(--t2)', lineHeight: 1.6, color: 'var(--ink-muted)', marginTop: 'var(--s2)' }}>
                  {d.problem}
                </p>
                <p
                  style={{
                    fontSize: 'var(--t2)',
                    lineHeight: 1.6,
                    color: 'var(--ink)',
                    marginTop: 'var(--s4)',
                    paddingTop: 'var(--s4)',
                    borderTop: '1px solid var(--rule)',
                  }}
                >
                  {d.relay}
                </p>
              </div>
            ))}
          </div>

          {/* The prose above is the summary; the table is what someone actually
              comparing options wants. Placed here rather than in the footer
              because this is the moment they are weighing alternatives. */}
          <div style={{ marginTop: 'var(--s8)' }}>
            <Link
              href="/how-it-works#compare"
              className="inline-flex min-h-[44px] items-center"
              style={{ fontSize: 'var(--t2)', fontWeight: 500, color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: '4px' }}
            >
              See the full comparison — including where Relay loses →
            </Link>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className={wrap} style={{ ...wrapStyle, paddingTop: 'var(--s12)', paddingBottom: 'var(--s12)' }}>
        <h2 style={sectionHeading}>Built like it matters</h2>
        <ul className="grid sm:grid-cols-3" style={{ gap: 'var(--s4)', marginTop: 'var(--s8)', listStyle: 'none', padding: 0 }}>
          {TRUST_POINTS.map((t) => (
            <li key={t} style={{ ...card, fontSize: 'var(--t2)', lineHeight: 1.6, color: 'var(--ink-muted)' }}>
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* Price + CTA */}
      <section style={{ borderTop: '1px solid var(--rule)' }}>
        <div className={wrap} style={{ ...wrapStyle, paddingTop: 'var(--s12)', paddingBottom: 'var(--s12)' }}>
          <div className="mx-auto text-center" style={{ ...card, maxWidth: '34rem', padding: 'var(--s8)' }}>
            <div style={{ fontSize: 'var(--t1)', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              One plan
            </div>
            <div style={{ fontSize: 'var(--t9)', fontWeight: 600, letterSpacing: '-0.02em', marginTop: 'var(--s3)' }}>
              ${PRICE_YEARLY_USD}
              <span style={{ fontSize: 'var(--t5)', fontWeight: 400, color: 'var(--ink-muted)' }}>/year</span>
            </div>
            <p style={{ fontSize: 'var(--t3)', lineHeight: 1.6, color: 'var(--ink-muted)', marginTop: 'var(--s3)' }}>
              One vault, unlimited recipients and triggers, every release reversible until the one
              that shouldn&apos;t be.
            </p>
            <Link href={intentHref('pricing')} style={{ ...primaryCta, marginTop: 'var(--s6)' }}>
              {CTA_LABEL}
            </Link>
            {/*
              A guarantee nobody is told about converts nobody. It sits under
              the CTA rather than in the headline: the pitch is reversible
              access, and leading with the refund would sell the exit.
            */}
            <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s4)' }}>
              {GUARANTEE_LABEL}. Cancel any time from your account page.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--rule)' }}>
        <div
          className={`${wrap} flex flex-col sm:flex-row sm:items-center sm:justify-between`}
          style={{ ...wrapStyle, gap: 'var(--s3)', paddingTop: 'var(--s8)', paddingBottom: 'var(--s8)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}
        >
          <div>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Relay</span> — standby access for the
            people who&apos;ll need it.
          </div>
          {/* These were "required by Meta and Reddit ad policy, and by anyone
              deciding whether to trust this with a parent's credentials."
              The ad-policy half expired on 2026-08-16 when paid advertising was
              retired; the second half is now the ONLY reason they are here, and
              it is the stronger one.

              🔴 /about ADDED 2026-08-16, and this is the page it matters on.
              Op-eds land readers HERE, not on the homepage — every editorial
              link is relaystandby.com/caregivers?src=ed-<outlet>. A reader
              asking "who is asking me to store my mother's passwords" had no
              route to an answer from this page, which is the one place the
              question actually gets asked. It is placed first for that reason.

              min-h-[44px] keeps them tappable on a phone. These measured 4.24:1
              on the old dark ground — below AA, on an audience that skews older.
              Ink-muted on paper is 5.2:1, and the underline means colour is not
              the only thing marking them. */}
          <div className="flex flex-wrap items-center" style={{ columnGap: 'var(--s5, 1.25rem)' }}>
            {[
              ['/about', 'About'],
              ['/how-it-works', 'How it works'],
              ['/security', 'Security'],
              ['/privacy', 'Privacy'],
              ['/terms', 'Terms'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-[44px] items-center"
                style={{ color: 'var(--ink-muted)', textDecoration: 'underline', textUnderlineOffset: '3px', marginRight: 'var(--s4)' }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
