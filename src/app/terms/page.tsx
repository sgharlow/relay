/**
 * Terms of service.
 *
 * Deliberately short and honest about what Relay is today: early software with
 * no estate/legal capability cleared and no guarantee of continuity.
 * Overclaiming here is the thing that would actually hurt someone.
 *
 * ⚠️ THIS DOCUMENT MAKES FACTUAL CLAIMS THAT GO STALE. It said "no paying
 * customers yet" for a day after the first live charge, and "Relay is not
 * currently taking payment" in the same week money was taken. Check the
 * standing claims against reality whenever billing or account behaviour
 * changes — a false statement here is worse than a missing one.
 *
 * Required alongside the privacy policy for Meta and Reddit ad accounts.
 *
 * NOT legal advice, and NOT counsel-reviewed. Gate g2-counsel-opinion was
 * declined on 2026-08-14 — no legal review is planned. That raises the bar on
 * this page rather than lowering it: with nobody checking the wording, it has to
 * describe the mechanism plainly and claim nothing the code does not do.
 *
 * Feature: relay-g1-wtp
 */

import { CONTACT_EMAIL, CONTACT_MAILTO } from '../../../lib/contact';
import { GUARANTEE_LABEL, PRICE_YEARLY_LABEL, REFUND_POLICY } from '../../../lib/offer';

export const metadata = {
  title: 'Terms · Relay',
  description: 'What Relay promises, what it does not, and what stage it is at.',
};

const UPDATED = '12 August 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-paper-raised px-6 py-12 text-t3 leading-relaxed text-ink">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-t7 font-semibold tracking-tight text-ink">Terms</h1>
          <p className="mt-2 text-muted">Last updated {UPDATED}</p>
        </header>

        <p className="rounded-lg border border-ochre bg-ochre-soft p-4">
          <strong>Relay is early-stage software.</strong> Please do not make it the only place
          something important is written down.
        </p>

        <section>
          <h2 className="text-t5 font-semibold text-ink">What Relay does</h2>
          <p className="mt-2">
            Relay stores information you choose to put in it, encrypted in your browser, and
            releases parts of it to people you designate when conditions you configure are met. You
            decide what is stored, who can reach it, and under what circumstances.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">What Relay does not do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {/*
              🔴 THIS USED TO END "Estate and inheritance functionality is not
              offered", and that sentence was not true of the mechanism. A
              deceased owner stops checking in, their armed emergency trigger
              arms on the heartbeat sweep (which does not filter by trigger
              type), verifiers confirm, and access opens — then stays open,
              because nothing closes a released state except the owner. Saying
              estate "is not offered" invited a reader to conclude nothing
              happens after they die, which is the opposite of what happens.

              Ratified 2026-08-14 alongside declining gate g2-counsel-opinion:
              the release persists, and the Terms say so. Naming people is the
              decision this asks the owner to make carefully — so it asks.
            */}
            <li>
              It is <strong>not a legal instrument</strong>. It is not a will, a power of attorney,
              or a substitute for either, and it gives no one legal authority over your affairs.
              Relay does not offer estate or inheritance services &mdash; there is no death-verified
              handoff, no executor role, and nothing here transfers ownership of anything.
            </li>
            <li>
              <strong>It does not stop when you do.</strong> Relay releases access when the
              conditions you set are met, and one of those conditions is that you stop checking in.
              If you never check in again &mdash; for any reason &mdash; an armed release will open
              to the people you named, and it will stay open until someone closes it. Relay does not
              close it for you. That is the behaviour you are configuring. Name people accordingly.
            </li>
            <li>
              It does not bypass anyone else&rsquo;s security. It organises access you already have
              the right to grant.
            </li>
            {/* Corrected 2026-08-08. This previously said losing your
                authenticator lost your data, "a consequence of encrypting in
                your browser". That was not accurate: data keys are held by AWS
                KMS and unwrapped for an authenticated account, so losing the
                authenticator loses the ability to SIGN IN, not the vault. The
                overstatement was in the safe direction but it was still false,
                and it would have deterred exactly the careful buyer this
                product is for. */}
            <li>
              It gives you recovery codes when you create your vault, and those are the only way
              back in if you lose your authenticator. Lose both and we cannot let you in — we can
              verify a recovery code, but we will not take anyone&rsquo;s word for who they are.
            </li>
            <li>
              It offers no uptime guarantee. Keep a copy of anything you cannot afford to lose.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Your responsibilities</h2>
          <p className="mt-2">
            Only store information you are entitled to hold. If you set Relay up on behalf of
            someone else, do it with their knowledge and consent — the software records that
            consent and reports your activity to them, deliberately.
          </p>
        </section>

        {/*
          Added 2026-08-12. Standby accounts went live days before this section
          existed, so the document described a product with one kind of user
          while shipping two — the §9.3 ship-gate, breached in the direction of
          the product outrunning the paperwork. Everything below states what the
          software already does; none of it is a new promise.
        */}
        <section>
          <h2 className="text-t5 font-semibold text-ink">If someone names you</h2>
          <p className="mt-2">
            Someone can name you as a person who would receive access, or as someone who would be
            asked whether an emergency is real. When they do, they give you a code — read out, texted,
            or handed to you — and that code sets up a <strong>standby account</strong> in your name.
          </p>
          <p className="mt-2">
            A standby account is free, and stays free. It holds no vault of its own and it is never
            billed — not to you, and not to the person who named you. If you also keep a vault of
            your own, standing by for other people uses none of its allowance. We will never send you
            a link that signs you in; if a message claiming to be Relay contains one, it is not from
            us.
          </p>
          <p className="mt-2">
            Nothing is asked of you until something happens. Until then you can see that you are on
            standby and who for. If you would receive access, you can see <em>how much</em> was set
            aside for you and roughly what kind of thing it is — never the contents, and never before
            the conditions they set are met. If you would be asked to confirm an emergency, you are
            shown nothing about their vault until you are actually asked; at that moment you are told
            how many things are involved and what kinds, so you can judge whether what is being asked
            for is proportionate. You are never shown a title, and never the contents — not then, and
            not afterwards.
          </p>
          <p className="mt-2">
            <strong className="font-semibold text-ink">You can step down at any time</strong>, from
            your standby page, and you do not need a reason. The person who named you is told, so
            they can find someone else — that is the point of telling them, and it is why stepping
            down is not something we will do quietly on your behalf. If you close your account
            entirely, you are released from every circle you were part of and each of those people
            is told.
          </p>
          <p className="mt-2">
            What you do in Relay is recorded in <em>their</em> log — when you accepted, when you
            answered, when you opened something. That is deliberate: it is how they know their plan
            is real. If you stand by for more than one person, none of them can learn about the
            others.
          </p>
          {/*
            Added 2026-08-15, ahead of A2P 10DLC registration, and placed HERE
            rather than in a section of its own because this is the page's one
            section addressed to the standby person rather than the owner — they
            are the only people we would ever text.

            Note what it does NOT say. This section already describes a code
            being "read out, texted, or handed to you" — that is the OWNER
            texting from their own phone, which is untouched by any of this and
            deliberately still allowed. The distinction between somebody else
            texting you and US texting you is the whole point, and carriers care
            about exactly that line.
          */}
          <p className="mt-2">
            If you choose to, you can give us a mobile number and we will text you when something
            genuinely needs you — an emergency being raised, or a reminder that one is still waiting.{' '}
            <strong className="font-semibold text-ink">
              You turn this on yourself and nobody can turn it on for you
            </strong>
            , not even the person who named you; a number they typed in is there to help{' '}
            <em>them</em> reach you, never used by us for texts. Reply STOP to any message and it
            ends, or HELP to reach us. Standard message and data rates apply, and how often you hear
            from us depends entirely on what happens. As with email, we will never text you a link
            that signs you in.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Payment and renewal</h2>
          <p className="mt-2">
            Relay costs {PRICE_YEARLY_LABEL} per year in US dollars for a vault of your own. You are never charged
            without going through checkout yourself, and there is a free tier you can stay on
            indefinitely. Standby accounts, described above, are free and are not part of this.
          </p>
          <p className="mt-2">
            <strong className="font-semibold text-ink">
              A subscription renews automatically every year at {PRICE_YEARLY_LABEL}
            </strong>{' '}
            until you cancel it, and the card you paid with is charged on each renewal date.
            Payments are processed by Stripe; we never see or store your card details.
          </p>
          <p className="mt-2">
            You can cancel at any time from the Subscription section of your account page, which
            opens Stripe&rsquo;s billing page — the same place you can update your card or read past
            invoices. Cancelling stops all future charges. Closing your account cancels the
            subscription too, so you never need to do both.
          </p>
          <p className="mt-2">
            <strong className="font-semibold text-ink">{GUARANTEE_LABEL}.</strong> {REFUND_POLICY}
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Ending it</h2>
          <p className="mt-2">
            You can close your account yourself, at any time, from your account page — it deletes
            your vault and cancels any subscription in the same step. You can export everything
            first. We may discontinue the service, and if we do we will give notice and a way to
            export what you have stored.
          </p>
          <p className="mt-2">
            Ending a subscription never deletes anything. Your vault stays exactly as it is; the
            free-tier limits apply only to adding more.
          </p>
          <p className="mt-2">
            Closing your account also releases you from anyone else&rsquo;s plan you were standing by
            for, and tells them so. We do not remove you from their list on your behalf — their
            record of you stays, marked as no longer set up, so their plan gets weaker visibly rather
            than silently.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Liability</h2>
          <p className="mt-2">
            Relay is provided as-is, without warranties. To the fullest extent the law allows, we
            are not liable for indirect or consequential loss arising from its use.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            <a className="text-ink underline" href={CONTACT_MAILTO}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </section>

        <footer style={{ borderTop: '1px solid var(--rule)', paddingTop: 'var(--s6)', color: 'var(--ink-muted)' }}>
          <a className="underline hover:text-ink" href="/caregivers">
            Back to Relay for caregivers
          </a>
          <span className="px-2">·</span>
          <a className="underline hover:text-ink" href="/privacy">
            Privacy
          </a>
        </footer>
      </div>
    </main>
  );
}
