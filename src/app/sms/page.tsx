/**
 * /sms — the public text-message terms.
 *
 * WHY THIS PAGE EXISTS AND WHY IT IS PUBLIC. A2P 10DLC campaign registration
 * requires an opt-in URL that a carrier reviewer can LOAD and check. The actual
 * opt-in lives behind a sign-in wall, where a reviewer cannot reach it — so the
 * consent language, the message samples and the stop/help behaviour are stated
 * here, in the open, exactly as they appear in the product and exactly as they
 * are registered with the carriers.
 *
 * ⚠️ THESE THREE MUST STAY IN LOCKSTEP: this page, the registered campaign
 * (docs/a2p-registration-prep.md), and the eventual send path. A sample message
 * edited here and not there is a compliance discrepancy, and it is the kind
 * nobody notices until a campaign is suspended.
 *
 * 🔴 IT SAYS PLAINLY THAT NOTHING HAS BEEN SENT YET, and that is deliberate.
 * Publishing terms in advance of the mechanism is normal for registration;
 * claiming a live toggle that does not exist is the thing that gets found out.
 * When the opt-in screen ships, delete the status note and nothing else on this
 * page should need to change — if it does, the page was wrong.
 *
 * Feature: relay-standby
 */

import Link from 'next/link';

import { CONTACT_EMAIL, CONTACT_MAILTO, SENDER_EMAIL } from '../../../lib/contact';

export const metadata = {
  title: 'Text messages · Relay',
  description: 'When Relay sends a text, who can turn it on, and how to stop it.',
};

const UPDATED = '15 August 2026';

/**
 * The registered sample messages, verbatim.
 *
 * Kept as data rather than prose so the three that are shown here are provably
 * the three that exist. They carry no code, no link and no promotional content
 * by design — see the note below the list.
 */
const SAMPLES = [
  'Relay: someone has asked for access to a vault you are named on. Please sign in at relaystandby.com to answer. Reply STOP to opt out.',
  'Relay: a request you were asked about is still waiting for an answer. Sign in at relaystandby.com. Reply STOP to opt out.',
  'Relay: this is a practice run, nothing is wrong. Sign in at relaystandby.com and press "I got this". Reply STOP to opt out.',
];

/** The exact wording beside the tick box, quoted so it can be compared. */
const CONSENT =
  'Text me if something needs my attention. Message and data rates may apply. ' +
  'Message frequency varies. Reply STOP to cancel or HELP for help.';

export default function SmsPage() {
  return (
    <main className="min-h-screen bg-paper-raised px-6 py-12 text-t3 leading-relaxed text-ink">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-t7 font-semibold tracking-tight text-ink">Text messages</h1>
          <p className="mt-2 text-muted">Last updated {UPDATED}</p>
        </header>

        <p className="rounded-lg border border-ochre bg-ochre-soft p-4">
          <strong className="font-semibold text-ink">Status:</strong> text messaging is not switched
          on yet, and Relay has never sent one. This page states the terms it will run under, in
          advance, so they can be read and checked before anything is sent.
        </p>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Who Relay would text, and why</h2>
          <p className="mt-2">
            Relay is a standby service. Somebody names a small number of people they trust — to
            confirm an emergency is genuine, or to be given access to specific things if one
            happens. Those people are the only ones we would ever text, and only about that.
          </p>
          <p className="mt-2">
            The messages exist because email is unreliable at exactly the wrong moment. A message
            that is filed as junk on the day it matters is the failure this whole product is built
            to survive.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">How it gets turned on</h2>
          <p className="mt-2">
            You turn it on yourself, signed in to your own Relay account, by adding a mobile number
            and ticking a box that reads:
          </p>
          <blockquote className="mt-3 rounded-lg border border-rule bg-paper-sunken p-4 text-t2">
            {CONSENT}
          </blockquote>
          <p className="mt-3">
            The box is empty until you tick it. We record that you ticked it, the wording you were
            shown, and when.
          </p>
          <p className="mt-2">
            <strong className="font-semibold text-ink">
              Nobody can turn this on for you — not even the person who named you.
            </strong>{' '}
            They may have typed a phone number in when they set up their plan, so that{' '}
            <em>they</em> can reach you. That number is never used by us for text messages. Only one
            you entered yourself, with the box ticked, is.
          </p>
          <p className="mt-2">
            We never buy, rent, import or otherwise obtain numbers from anywhere else, and we do not
            sell, rent or share yours.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">What the messages say</h2>
          <p className="mt-2">These are the messages, in full:</p>
          <ul className="mt-3 space-y-3">
            {SAMPLES.map((s) => (
              <li
                key={s}
                className="rounded-lg border border-rule bg-paper-sunken p-4 font-mono text-t1"
              >
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-3">
            Every one of them says the same thing in different words: something needs you, go and
            sign in. <strong className="font-semibold text-ink">There is never a code in a text
            message, never a link that signs you in, and never anything to buy.</strong> That is not
            a courtesy — it is the security model. A message worth intercepting is a message worth
            faking, so ours are worth neither.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">How to stop</h2>
          <p className="mt-2">
            Reply <strong className="font-semibold text-ink">STOP</strong> to any message and we stop
            immediately. You can also switch it off on the same screen you switched it on, and you
            can delete the number entirely.
          </p>
          <p className="mt-2">
            Reply <strong className="font-semibold text-ink">HELP</strong> and you get:
          </p>
          <blockquote className="mt-3 rounded-lg border border-rule bg-paper-sunken p-4 font-mono text-t1">
            Relay: help at relaystandby.com or {CONTACT_EMAIL}. Reply STOP to opt out.
          </blockquote>
          <p className="mt-3">
            Stopping texts changes nothing else. You keep your account, you stay in the circle of
            whoever named you, and you still get email.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Frequency, and what it costs</h2>
          <p className="mt-2">
            Message and data rates may apply — that is between you and your carrier; we charge
            nothing for this.
          </p>
          <p className="mt-2">
            Frequency varies, and for most people it is <em>nothing at all</em>. Messages are sent
            when something actually happens: a request is raised on a vault you are named on, an
            answer is still outstanding, or the person who named you runs a practice run. In a
            typical year that may be zero messages. There is no newsletter and no schedule.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">The rest of it</h2>
          <p className="mt-2">
            What we store and what we cannot read is in the{' '}
            <Link href="/privacy" className="underline underline-offset-2">
              privacy policy
            </Link>
            ; the agreement itself is in the{' '}
            <Link href="/terms" className="underline underline-offset-2">
              terms
            </Link>
            . Our email comes from {SENDER_EMAIL}, and a real person reads{' '}
            <a href={CONTACT_MAILTO} className="underline underline-offset-2">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
