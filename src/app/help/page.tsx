/**
 * /help — the support surface.
 *
 * 🔴 THE PRODUCT HAD NO SUPPORT PATH, found by the pre-release review on
 * 2026-08-13. That gap is sharper here than in most products: Relay cannot reset
 * an authenticator, cannot decrypt a vault, and cannot un-spend a recovery code.
 * All three are correct, and all three produce a person with nowhere to go. A
 * product that will not rescue you owes you a plain account of what to do
 * instead — and somebody to write to when it does not cover your case.
 *
 * ORDERED FOR THE FRIGHTENED READER. Contacts come first, not owners: the person
 * most likely to arrive here is somebody who has just been told a person they
 * love may be unreachable, holding a code they did not ask for. Owners are
 * usually at a desk with time.
 *
 * A SERVER COMPONENT over shared data. The answers live in lib/support/faq.ts so
 * the assistant Steve wants later reads the same definition this page renders,
 * rather than a second copy that drifts from it.
 *
 * Feature: relay-h0-mvp
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { AUDIENCE_LABELS, faqFor, type Audience } from '../../../lib/support/faq';
import { SupportForm } from './SupportForm';

export const metadata: Metadata = {
  title: 'Help · Relay',
  description:
    'Answers to what people actually ask about Relay — and a way to reach a person when they do not cover it.',
};

const ORDER: Audience[] = ['contact', 'owner', 'safety'];

export default function HelpPage() {
  return (
    <main
      className="mx-auto px-4 py-10"
      style={{ maxWidth: 'var(--measure-access)', color: 'var(--ink)' }}
    >
      <header>
        <h1 style={{ fontSize: 'var(--t7)', fontWeight: 600, letterSpacing: '-0.01em' }}>Help</h1>
        <p className="mt-2" style={{ fontSize: 'var(--t3)', lineHeight: 1.6, color: 'var(--ink-muted)' }}>
          The questions people actually ask, answered honestly — including the ones where the answer
          is that nobody can fix it, us included.
        </p>
      </header>

      {/*
        Stated once, at the top, before anybody scrolls. Somebody arriving here
        after a suspicious email needs this in the first screenful, not filed
        under a heading they would have to think to open.
      */}
      <div
        className="mt-6 rounded p-4"
        style={{ background: 'var(--paper-sunken)', fontSize: 'var(--t2)', lineHeight: 1.6 }}
      >
        {/*
          🔴 THIS PROMISE USED TO BE ABSOLUTE, AND ABSOLUTELY FALSE. "Relay
          never sends you a link that signs you in. Not one, ever" — while the
          recorded, deliberate last-resort email for an unclaimed recipient
          whose code could not be minted carries exactly such a link, because a
          stateless token is the one thing that still works when the database
          write that mints codes has just failed. A family member who took the
          absolute promise seriously would discard the genuine emergency email
          as phishing.

          The rule below is the one that IS true in every branch, and it is the
          one that actually defeats phishing: harvesting needs the victim to
          ENTER something after clicking, and no Relay message ever asks that.
        */}
        <strong>A real message from Relay never asks you to click a link and then sign in or enter
        anything.</strong> When something needs you, we send a short code and you type it at
        relaystandby.com — an address you come to yourself. In the one rare failure case where we
        send a personal access link, even that link asks you for nothing after you follow it. So a
        message that asks you to click and then log in, or click and then enter a code, is an
        imitation — however convincing it looks.
      </div>

      {/*
        The guide, finally reachable. It had been written in full — 42 sections,
        with screenshots — and shipped nowhere, which the pre-release audit found
        on 2026-08-13. Placed above the FAQ rather than below it: somebody who
        wants the whole picture should not have to read forty questions to
        discover a book exists.
      */}
      <div
        className="mt-6 rounded p-4"
        style={{ background: 'var(--paper-raised)', border: '1px solid var(--rule)' }}
      >
        <h2 style={{ fontSize: 'var(--t3)', fontWeight: 600 }}>The full guide</h2>
        <p className="mt-1" style={{ fontSize: 'var(--t2)', lineHeight: 1.6, color: 'var(--ink-muted)' }}>
          Everything Relay does, written for you and the people you name — setting it up, living with
          it, the day it matters, and what to do when something goes wrong.
        </p>
        <p className="mt-2" style={{ fontSize: 'var(--t2)' }}>
          <a href="/guide" className="underline">
            Read the guide
          </a>{' '}
          ·{' '}
          {/*
            A PDF is not a nicety here. CC8 asks for a printable fallback, the
            wedge is elderly owners, and a guide you can put in the drawer with
            the recovery codes is the form this one is most likely to be used in.
          */}
          <a href="/guide/relay-guide.pdf" className="underline">
            Download as PDF
          </a>
        </p>
      </div>

      {ORDER.map((audience) => (
        <section key={audience} className="mt-10">
          <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600 }}>{AUDIENCE_LABELS[audience]}</h2>
          <div className="mt-3">
            {faqFor(audience).map((entry) => (
              <details
                key={entry.id}
                id={entry.id}
                className="border-t"
                style={{ borderColor: 'var(--rule)', padding: 'var(--s3) 0' }}
              >
                <summary
                  className="cursor-pointer"
                  style={{ fontSize: 'var(--t3)', fontWeight: 500, minHeight: 44 }}
                >
                  {entry.question}
                </summary>
                {entry.answer.map((para, i) => (
                  <p
                    key={i}
                    className="mt-2"
                    style={{ fontSize: 'var(--t2)', lineHeight: 1.65, color: 'var(--ink-muted)' }}
                  >
                    {para}
                  </p>
                ))}
                {/*
                  Flagged rather than buried. When the honest answer is "this
                  cannot be undone by anyone", saying so plainly is kinder than
                  letting somebody keep looking for the button.
                */}
                {entry.irreversible ? (
                  <p
                    className="mt-2"
                    style={{ fontSize: 'var(--t1)', color: 'var(--clay)', fontWeight: 500 }}
                  >
                    There is no way around this one — not by us, and not by anybody.
                  </p>
                ) : null}
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="mt-12">
        <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600 }}>Still stuck?</h2>
        <p className="mt-2 mb-4" style={{ fontSize: 'var(--t2)', lineHeight: 1.6, color: 'var(--ink-muted)' }}>
          Write to us. Relay is small enough that a person reads every message — there is no queue
          and no ticket number.
        </p>
        <SupportForm />
      </section>

      <p className="mt-10" style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
        <Link href="/" className="underline">
          Back to Relay
        </Link>{' '}
        ·{' '}
        <Link href="/how-it-works" className="underline">
          How it works
        </Link>{' '}
        ·{' '}
        <Link href="/security" className="underline">
          Security
        </Link>
      </p>
    </main>
  );
}
