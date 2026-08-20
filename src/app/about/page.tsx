/**
 * /about — who is behind this.
 *
 * WHY THIS EXISTS. The 2026-08-16 readiness assessment found that Relay named
 * no provider anywhere: the Terms of Service — a contract a paying customer
 * enters — said "Relay is early-stage software" and "provided as-is" without
 * ever saying by whom. There was no company, no named human, and one contact
 * address in a footer.
 *
 * That was survivable while the plan was paid advertising, where nobody checks
 * who you are. It stopped being survivable when the plan became op-eds in AARP
 * and caregiver.com (`ratified.retire-paid-advertising`), because editorial has
 * two gatekeepers who both check: the editor, who needs an attributable author
 * before they will publish, and the reader, who is being asked to hand a
 * stranger their family's passwords.
 *
 * /security already put the problem in one sentence, about itself: "a caregiver
 * about to put their mother's bank login into a website run by someone they
 * have never heard of". This page is the answer to that sentence.
 *
 * ⚠️ NO EMPLOYMENT DETAIL, EVER. `ratified.relay-operator-is-an-individual`
 * names Steve as Relay's operator and draws the boundary explicitly: naming him
 * is the point, and pulling in anything about his employment is not. The
 * employer-anonymity rule is unchanged and binds anything written here or in a
 * bio supplied to an outlet.
 *
 * Feature: relay-h0-mvp
 */

import Link from 'next/link';

import { CONTACT_EMAIL, CONTACT_MAILTO, OPERATOR_NAME, OPERATOR_PROFILE_URL } from '../../../lib/contact';

const TITLE = 'About — who is behind Relay';
const DESCRIPTION =
  'Relay is independent software built and run by one person, Steve Harlow. Who made it, why, and how to reach a human.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: { type: 'website', siteName: 'Relay', url: '/about', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-paper-raised text-ink">
      <header className="mx-auto max-w-3xl px-6 pb-2 pt-14">
        <Link
          href="/caregivers"
          style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', textDecoration: 'underline', textUnderlineOffset: '3px' }}
        >
          ← Relay for caregivers
        </Link>
        <h1 className="mt-4 font-serif text-t9 font-semibold leading-tight tracking-tight text-ink">
          Who is behind Relay
        </h1>
        <p className="mt-4 text-t4 leading-relaxed text-ink">
          Relay asks you to trust it with the accounts that matter most to your family. You should
          know who is asking.
        </p>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="font-serif text-t6 font-semibold text-ink">One person, named</h2>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          Relay is built and operated by <strong>{OPERATOR_NAME}</strong>. Not a company — an
          individual. There is no team behind the word &ldquo;we&rdquo;, so this page does not use
          it.
        </p>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          That is worth being plain about rather than dressing up. Independent software has real
          limits, and they are set out in the{' '}
          <Link href="/terms" className="underline underline-offset-2">
            Terms
          </Link>{' '}
          and on the{' '}
          <Link href="/security" className="underline underline-offset-2">
            security page
          </Link>
          , including the honest answer to what happens to your vault if Relay stops existing.
        </p>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          <a href={OPERATOR_PROFILE_URL} className="underline underline-offset-2" rel="me noopener noreferrer" target="_blank">
            Steve on LinkedIn
          </a>
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-10" style={{ borderTop: '1px solid var(--rule)' }}>
        <h2 className="font-serif text-t6 font-semibold text-ink">Why it exists</h2>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          Most families handle this the only way they know how: one person keeps everything, and if
          that person is suddenly unreachable, nobody else can get in. The usual fix is to share the
          passwords — which works right up until it doesn&rsquo;t, and cannot be undone.
        </p>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          Relay exists because the reverse should be possible: access that opens only when people
          you trust confirm something real has happened, gives out only what you chose in advance,
          and <strong>seals itself again when you check back in</strong>. Setting it up should not
          require deciding to give anything away permanently.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-10" style={{ borderTop: '1px solid var(--rule)' }}>
        <h2 className="font-serif text-t6 font-semibold text-ink">
          What happens to Relay if something happens to me
        </h2>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          This product is about the day somebody cannot act. It would be a poor answer to that
          question to avoid it about myself, so: Relay is run by one person, and there is no
          company behind me, no co-founder, and no arrangement with anybody to take it over.
        </p>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          If I stopped — and the bills stopped being paid — the service would stop with me.{' '}
          <strong>A stopped service cannot release anything to anyone.</strong> Nobody you have
          named would be given access, because the thing that gives them access is the thing that
          is gone. I would rather write that plainly than let it be discovered.
        </p>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          What is not at risk is your <strong>content</strong>. Vault items are encrypted in your
          browser, and I could not read them on my best day. So the failure above is a loss of
          service, not a leak — and the same design means I could not hand your vault to a
          successor even if there were one.
        </p>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          <strong>The thing you can do about it takes one click and needs nothing from me.</strong>{' '}
          Under Account there is an export. It decrypts your whole vault in your own browser and
          writes it to a file you keep. Do it once and you are holding a copy that outlives Relay,
          me, and your subscription. If you only ever act on one sentence from this page, that is
          the one.
        </p>
        <p className="mt-3 text-t2 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          If Relay is ever wound down deliberately rather than abruptly, you will hear it from this
          address with time to export. That is an intention, and I am not dressing it up as a
          guarantee — a guarantee would need somebody other than me to enforce it, and there is
          nobody.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-10" style={{ borderTop: '1px solid var(--rule)' }}>
        <h2 className="font-serif text-t6 font-semibold text-ink">Reaching a human</h2>
        <p className="mt-3 text-t3 leading-relaxed text-ink">
          <a href={CONTACT_MAILTO} className="underline underline-offset-2">
            {CONTACT_EMAIL}
          </a>{' '}
          reaches Steve directly. It is read by a person, not a queue, and it is the right address
          for support, security reports, refunds and press.
        </p>
        <p className="mt-3 text-t2 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Writing about family caregiving or digital access and want to ask something? Same address.
        </p>
      </section>
    </main>
  );
}
