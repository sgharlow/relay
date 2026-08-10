/**
 * Terms of service.
 *
 * Deliberately short and honest about what Relay is today: pre-launch software
 * with no paying customers, no estate/legal capability cleared, and no
 * guarantee of continuity. Overclaiming here is the thing that would actually
 * hurt someone.
 *
 * Required alongside the privacy policy for Meta and Reddit ad accounts.
 *
 * NOT legal advice. Counsel review is pending under gate g2-counsel-opinion.
 *
 * Feature: relay-g1-wtp
 */

export const metadata = {
  title: 'Terms · Relay',
  description: 'What Relay promises, what it does not, and what stage it is at.',
};

const UPDATED = '7 August 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-paper-raised px-6 py-12 text-[17px] leading-relaxed text-ink">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-t7 font-semibold tracking-tight text-ink">Terms</h1>
          <p className="mt-2 text-muted">Last updated {UPDATED}</p>
        </header>

        <p className="rounded-lg border border-ochre bg-ochre-soft p-4">
          <strong>Relay is early-stage software and has no paying customers yet.</strong> Please do
          not make it the only place something important is written down.
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
            <li>
              It is <strong>not a legal instrument</strong>. It is not a will, a power of attorney,
              or a substitute for either. Estate and inheritance functionality is not offered.
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

        <section>
          <h2 className="text-t5 font-semibold text-ink">Payment</h2>
          <p className="mt-2">
            Relay is not currently taking payment. Where a price is shown, it is the intended
            price; you will not be charged without a separate, explicit checkout step.
          </p>
        </section>

        <section>
          <h2 className="text-t5 font-semibold text-ink">Ending it</h2>
          <p className="mt-2">
            You can ask us to delete your account at any time. We may discontinue the service, and
            if we do we will give notice and a way to export what you have stored.
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
          <a className="underline hover:text-ink" href="/privacy">
            Privacy
          </a>
        </footer>
      </div>
    </main>
  );
}
