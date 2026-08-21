/**
 * Privacy policy.
 *
 * Written from what the code ACTUALLY does, verified against the schema and the
 * AI metadata accessor — not from a template. The important disclosure is the
 * one a template would miss: item LABELS (title, service name, URL, category)
 * are stored unencrypted, while only the secret payload is encrypted. The
 * marketing copy says "encrypted in your browser", which is true of the secret
 * and not of the label, and this page has to say so plainly.
 *
 * Required for Meta and Reddit ad accounts, and for anyone deciding whether to
 * trust this with a parent's credentials.
 *
 * NOT legal advice, and NOT counsel-reviewed. Gate g2-counsel-opinion was
 * declined on 2026-08-14 — no legal review of this page is planned. Written to
 * be accurate about what the product does rather than to survive scrutiny it
 * has not had.
 *
 * Feature: relay-g1-wtp
 */

import { CONTACT_EMAIL, CONTACT_MAILTO, OPERATOR_NAME } from '../../../lib/contact';

export const metadata = {
  title: 'Privacy · Relay',
  description: 'What Relay stores, what it cannot read, and who it shares with.',
};

// Moves with the content — see the note in src/app/terms/page.tsx and the
// guard in src/app/terms/legal-pages.test.ts.
const UPDATED = '21 August 2026';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-paper-raised px-6 py-12 text-t3 leading-relaxed text-ink">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-t7 font-semibold tracking-tight text-ink">Privacy</h1>
          <p className="mt-2 text-muted">Last updated {UPDATED}</p>
        </header>

        <p className="rounded-lg border border-ochre bg-ochre-soft p-4">
          Relay is early. This page describes exactly what the software does today. Where something
          is a limitation rather than a protection, it says so.
        </p>

        <section>
          <h2 className="text-t5 font-semibold text-ink">What we cannot read</h2>
          <p className="mt-2">
            The secret content of every vault item — the password, the account number, the note —
            is encrypted <strong>in your browser</strong> with a key we never receive in usable
            form. Our servers store only the ciphertext and a copy of that key wrapped by AWS KMS.
            We cannot decrypt your secrets, and neither can anyone who obtains our database.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">What we can read</h2>
          <p className="mt-2">
            This is the part most services leave vague, so to be direct: the{' '}
            <strong>labels</strong> you give an item are <strong>not</strong> encrypted. We store,
            in readable form:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            <li>the item title and service name (e.g. &ldquo;Chase&rdquo;)</li>
            <li>the website address you associate with it</li>
            <li>its category and how critical you marked it</li>
            <li>which items you said depend on which others</li>
            <li>your email address, and when you last checked in</li>
            <li>the names, emails and phone numbers of people you designate</li>
            <li>
              the secret behind <strong>your own</strong> sign-in authenticator — the one Relay
              gave you when you created the account. It is stored on our servers in readable
              form, unlike everything in your vault
            </li>
          </ul>
          <p className="mt-3">
            So we can tell that you store a Chase account. We cannot tell you anything about it.
            If the mere existence of an account is sensitive to you, do not label it accurately.
          </p>
          <p className="mt-3">
            The last item is the sharpest one and it is listed deliberately. Your vault contents
            are encrypted where we cannot reach them; your <em>sign-in</em> authenticator is not.
            Anyone who obtained our database could not read a single vault item — but they could
            generate your sign-in codes. That is why the vault is worth what it is and the
            database alone is not, and why we would tell you about a breach rather than reassure
            you with the first half of that sentence.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Automated analysis</h2>
          <p className="mt-2">
            Relay ranks your items by consequence and works out which credentials others depend on.
            That analysis runs over the labels above and <strong>never</strong> over your secrets —
            the component that performs it is technically prevented from decrypting anything. Some
            of it uses a third-party language model (OpenAI), which therefore receives item labels
            but never secret content.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Who else is involved</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Amazon Web Services</strong> — database and key management (United States)</li>
            <li><strong>Vercel</strong> — hosting and privacy-friendly, cookieless analytics</li>
            <li><strong>OpenAI</strong> — the labels-only analysis described above</li>
            <li><strong>Resend</strong> — sending email such as invitations and alerts</li>
            <li>
              <strong>Stripe</strong> — payment processing, if you subscribe. Your card details go
              to Stripe directly and never reach our servers; we keep only the fact that a
              subscription exists and its status
            </li>
          </ul>
          <p className="mt-3">
            We do not sell your data, we do not share it for advertising, and there are no
            advertising or tracking cookies on this site.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">People you designate</h2>
          <p className="mt-2">
            When you name a recipient or a trusted contact, we store their name and contact details
            and may email them. A recipient sees only what you granted them, and only after the
            conditions you set are met.
          </p>
          {/*
            🔴 THE CONSENT HAS TO COME FROM THE SUBSCRIBER, NOT FROM YOU.
            Added 2026-08-15, ahead of A2P 10DLC registration. The list above
            says we store "the names, emails and phone numbers of people you
            designate" — so a number can arrive here typed by somebody else.
            Carriers require SMS consent from the person who owns the handset,
            and it is the right rule anyway: being named by a third party is not
            agreement to be texted by us.

            So the sentence below is load-bearing rather than decorative. Any
            future opt-in screen must read the number the PERSON entered while
            signed in, never the one on the roster row, or this page becomes
            false and the campaign becomes non-compliant in the same stroke.
          */}
          {/*
            🔴 "with the box ticked" DESCRIBED A BOX THAT DOES NOT EXIST. There is
            no opt-in screen, no field collects a mobile number, and /sms says
            Relay has never sent a text. The rule below is right and is the one
            any future screen must implement — it was simply written as though
            it already had been. Qualified, not deleted: the disclosure itself
            is what A2P review looks for (lib/ops/sms-disclosure.test.ts).
          */}
          <p className="mt-2">
            <strong className="font-semibold text-ink">Text messages.</strong> Text messaging is not
            switched on yet and Relay has never sent one; this is the rule it will run under. We
            would only text someone who gave us a mobile number themselves, from inside their own
            signed-in account, having chosen it. It would be off unless chosen, and could be switched
            off there or by replying STOP.{' '}
            <strong className="font-semibold text-ink">
              A number somebody else entered for you is never used for text messages
            </strong>{' '}
            — only one you added yourself. We use it for a single thing: telling you something needs
            your attention and that you should sign in. Never marketing, and never a code, a link, or
            anything else worth intercepting. Message and data rates may apply and message frequency
            varies. We do not sell, rent or share these numbers.
          </p>
          {/*
            Sharpened 2026-08-12. This said a trusted contact is "never shown
            your vault, before or after", which is not precise: at the moment
            they are asked, they are shown how many items and which categories,
            because J7-R3 requires them to judge whether the request is
            proportionate and nobody can do that blind to scale. The line that
            actually holds is CONTENT, not scale — the same correction made to
            §3.1 of the architecture the same day, for the same reason.
          */}
          <p className="mt-2">
            A trusted contact is only ever asked whether a situation is real. Until they are asked
            they see nothing about your vault; at that moment they are told how many items are
            involved and which categories, so they can judge whether the request is proportionate.
            They are never shown a title and never any content, at any point.
          </p>
          <p className="mt-2">
            They can also set up a free <strong>standby account</strong> of their own, described
            below. If they do, they sign in as themselves rather than following a link you forwarded,
            and nothing secret is sent to them when your plan opens.
          </p>
        </section>

        {/*
          Added 2026-08-12. Standby accounts shipped days before this page
          mentioned them, so it described what we hold about designated people
          as though they were only rows in someone else's vault. They are users
          now, and a privacy policy that does not say what it holds about a
          person is the wrong document to be vague in.
        */}
        <section>
          <h2 className="text-t5 font-semibold text-ink">If someone named you</h2>
          <p className="mt-2">
            Someone can name you in their plan and give you a code that sets up a standby account.
            About you, we then hold:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            <li>
              the name and contact details <em>they</em> entered for you — not what you told us
            </li>
            <li>a sign-in session, kept in a cookie that exists only to keep you signed in</li>
            <li>
              if you set up a passkey, the public half of it — never anything that could sign as you
            </li>
            <li>
              a scrambled form of any emergency code you were given, which we cannot turn back into
              the code
            </li>
          </ul>
          <p className="mt-3">
            <strong>What you do is recorded in their log, not yours.</strong> When you accepted, when
            you answered a question, when you opened something they left you — all of it lands in the
            tamper-evident record described above, which belongs to the person who named you. That is
            how they know their plan works, and you should know it is the arrangement before you take
            part.
          </p>
          <p className="mt-3">
            If you stand by for more than one person, <strong>none of them can learn about the
            others</strong>. There is no screen anywhere that shows one of them your other
            relationships.
          </p>
          <p className="mt-3">
            You can step down from any circle at any time from your standby page, and you can close
            your account outright. Either way the people affected are told, because a plan that
            quietly gets weaker is the failure this product exists to prevent.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Records we keep</h2>
          <p className="mt-2">
            Every access and release event is written to a tamper-evident log so you can audit what
            happened. That log is append-only by design: entries are never edited or deleted, which
            means some record of an event survives even after you delete the underlying item.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Deleting your data</h2>
          {/*
            Corrected 2026-08-12. This said "email us and we will delete your
            account" after self-serve export and deletion had shipped (J13) —
            understating the product rather than overstating it, but still not
            what the software does. Both directions are the same defect.
          */}
          <p className="mt-2">
            You can close your account yourself from your account page, at any time, and export
            everything first. It removes your vault, the people you listed, your passkeys and any
            emergency codes you had issued. If you would rather we did it, email us.
          </p>
          {/*
            🔴 THIS SAID "Two things deliberately survive" AND LISTED TWO, and
            three more did. A closed count is the sentence that goes quietly
            wrong when a fourth thing appears — so it is an open list now.

            What was missing:
              · email_delivery_events. Every owner's and contact's address, in
                plaintext, deliberately NOT owner-scoped (migration 027: "the
                fact lives against an ADDRESS"), and no DELETE anywhere targets
                it. So the addresses of "the people you listed" outlived the
                deletion indefinitely, on a page saying they were removed.
              · caregiver_leads — an address and a free-text note from the
                interest form, with no deletion path, and this page had never
                mentioned that form existing at all.
              · backups, at 35 days (docs/backup-restore-runbook.md).

            lib/account/lifecycle.ts sets the standard: "The promise and the
            implementation must agree, so the code follows the document."
            DELETING the delivery records is a retention decision rather than a
            copy one — a deleted delivery record is also a deleted bounce
            history, which is what stops us mailing a dead address forever — so
            it is not taken here. Saying what is true is not a decision.
          */}
          <p className="mt-2">
            Some things deliberately survive, and this is the whole list. The append-only event log
            described above stays, and it contains no secret material. If you were standing by for
            someone else, their record of you stays on their list — unlinked from you and marked
            as no longer set up — because deleting it would quietly shrink their plan without
            telling them.
          </p>
          <p className="mt-2">
            Two more survive that are worth naming plainly. We keep{' '}
            <strong className="font-semibold text-ink">delivery records</strong> — the fact that an
            email reached, bounced from, or was refused by a particular address, including addresses
            of people you listed. They are held against the address rather than against your
            account, so closing your account does not remove them; they are what stops us sending
            forever to a mailbox that no longer exists. And{' '}
            <strong className="font-semibold text-ink">backups</strong> of the database are kept for
            35 days, so a deletion is gone from every copy only once that window has passed.
          </p>
          <p className="mt-2">
            Separately: if you used the{' '}
            <strong className="font-semibold text-ink">interest form</strong> on the caregivers
            page, the address and note you sent are stored so we can reply. That is not part of an
            account and is not removed by closing one — email us and we will delete it.
          </p>
        </section>

        <section>
          {/*
            THE DATA CONTROLLER, NAMED. Added 2026-08-16 alongside the same fix
            in /terms. A privacy notice that never says who holds the data is
            asking for trust from an anonymous party — see
            docs/product-readiness-assessment-2026-08-16.md.
          */}
          <h2 className="text-t5 font-semibold text-ink">Who holds this data, and how to reach him</h2>
          <p className="mt-2">
            Relay is operated by <strong>{OPERATOR_NAME}</strong>, an individual — there is no
            company. He is responsible for the data described above.
          </p>
          <p className="mt-2">
            <a className="text-ink underline" href={CONTACT_MAILTO}>
              {CONTACT_EMAIL}
            </a>{' '}
            — read by a person. More at{' '}
            <a className="text-ink underline" href="/about">
              about
            </a>
            .
          </p>
        </section>

        <footer style={{ borderTop: '1px solid var(--rule)', paddingTop: 'var(--s6)', color: 'var(--ink-muted)' }}>
          <a className="underline hover:text-ink" href="/caregivers">
            Back to Relay for caregivers
          </a>
          <span className="px-2">·</span>
          <a className="underline hover:text-ink" href="/terms">
            Terms
          </a>
        </footer>
      </div>
    </main>
  );
}
