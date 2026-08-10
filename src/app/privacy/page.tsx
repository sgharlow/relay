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
 * NOT legal advice. Counsel review is pending under gate g2-counsel-opinion.
 *
 * Feature: relay-g1-wtp
 */

export const metadata = {
  title: 'Privacy · Relay',
  description: 'What Relay stores, what it cannot read, and who it shares with.',
};

const UPDATED = '7 August 2026';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-paper-raised px-6 py-12 text-[17px] leading-relaxed text-ink">
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
          </ul>
          <p className="mt-3">
            So we can tell that you store a Chase account. We cannot tell you anything about it.
            If the mere existence of an account is sensitive to you, do not label it accurately.
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
            and may email them. A trusted contact is only ever asked whether a situation is real —
            they are never shown your vault, before or after. A recipient sees only what you
            granted them, and only after the conditions you set are met.
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
          <p className="mt-2">
            Email us and we will delete your account and vault contents. The append-only event log
            described above is the one exception, and it contains no secret material.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            <a className="text-ink underline" href="mailto:sgharlow+relay@gmail.com">
              sgharlow+relay@gmail.com
            </a>
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
