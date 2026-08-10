/**
 * /how-it-works — what actually happens, for a person.
 *
 * WHY THIS PAGE EXISTS. The site's front door was still the hackathon
 * submission: "built on Amazon Aurora DSQL", a stack section, state-machine
 * badges. Worse, the caregiver landing page linked to it as "About Relay", so
 * the one link a curious buyer clicked took them from good copy to a page about
 * database consistency.
 *
 * But the deeper reason is about the pitch, not the plumbing. The landing page
 * leads with reversibility, which is correct — no competitor closes access
 * again. Except that "it closes itself" answers a question the reader has not
 * asked yet. It reads as a nice-to-have until you have pictured the six-week
 * hospital stay AND the recovery afterwards. This page is where that lands, so
 * the differentiator is earned rather than asserted.
 *
 * Order is deliberate: the story first, because it makes the table mean
 * something; the table second, because a buyer comparing options needs one.
 *
 * Feature: relay-g1-wtp
 */

import Link from 'next/link';

import { PRICE_YEARLY_USD } from '../caregivers/content';
import { COLUMNS, ROWS, CELL_MARK, VERIFIED_ON } from './comparison';

const TITLE = 'How Relay works — and how it compares';
const DESCRIPTION =
  'What actually happens when a parent lands in hospital: who asks, who confirms, what opens, and how it closes again when they recover. Plus an honest comparison with the alternatives.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/how-it-works' },
  openGraph: { type: 'website', siteName: 'Relay', url: '/how-it-works', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/** The sequence, in the order a family lives it. */
const TIMELINE = [
  {
    when: 'Before anything happens',
    title: 'Margaret sets it up — or her daughter does, with her permission',
    body:
      'The accounts that matter go in: her email, the bank, the insurer, the pharmacy. Relay works out which ones unlock the others — her email resets almost everything, so it is the one that matters most. She names Sarah as the person who can step in, and her GP as someone who can confirm a real emergency. Nothing is open. Nothing is shared.',
  },
  {
    when: 'Tuesday afternoon',
    title: 'The call comes',
    body:
      'Margaret is in hospital and will not be managing anything for a while. Sarah needs the pharmacy account, the insurer, and eventually the bank — and has none of it.',
  },
  {
    when: 'Within minutes',
    title: 'Sarah asks, and Margaret is asked first',
    body:
      'Sarah requests access. Relay does not ask a stranger to adjudicate — it asks Margaret, in case she can simply say yes. She cannot answer, so after a short window it moves on.',
  },
  {
    when: 'The same afternoon',
    title: 'The GP confirms it is real',
    body:
      'He gets one question: is this genuine? He is never shown anything of Margaret’s — not then, and not after. He answers yes, and that is the whole of his involvement.',
  },
  {
    when: 'Immediately after',
    title: 'Only what Margaret chose opens',
    body:
      'Sarah gets exactly the items Margaret assigned to her, most consequential first, so she is not reading a list at the worst moment of her month. Everything she opens is recorded. Everything she does not open is recorded too.',
  },
  {
    when: 'Six weeks later',
    title: 'Margaret comes home, and it closes',
    body:
      'She checks in. Sarah’s access ends the same minute — no awkward conversation, nothing to ask for back. Sarah is told what happened and thanked, and Margaret gets a record of exactly what was opened while she was away. The vault is armed again, ready for next time.',
  },
];

/** Deliberately excludes estate: it is gated on counsel and the terms page says it is not offered. */
const USE_CASES = [
  {
    title: 'A hospital stay',
    body:
      'The one this is built for. Bills keep arriving, prescriptions need refilling, and the person who normally handles it is on a ward. Access opens for as long as it is needed and ends when they are home.',
  },
  {
    title: 'Caring for a parent whose memory is going',
    body:
      'Not a single event but a slope. You need more over time, they stay in control for as long as they can, and every step is recorded so no sibling has to take anyone’s word for anything.',
  },
  {
    title: 'Travel, surgery, or anything with a date on it',
    body:
      'Two weeks somewhere with bad signal, or a procedure with a recovery period. Give someone what they would need if you were unreachable, and take it back when you are not.',
  },
];

function Mark({ state }: { state: keyof typeof CELL_MARK }) {
  const { mark, label } = CELL_MARK[state];
  const tone =
    state === 'yes'
      ? 'text-sage-text'
      : state === 'partial'
        ? 'text-ochre-text'
        : state === 'unknown'
          ? 'text-muted'
          : 'text-muted';
  return (
    <span className={`text-t5 ${tone}`} title={label}>
      {mark}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * `overflow-x-hidden` on <main> is load-bearing, not tidiness.
 *
 * The comparison table carries min-w-[720px] so its columns stay readable, and
 * it sits in an overflow-x-auto container that clips it VISUALLY — but the
 * min-width still propagated into the ROOT scroller, so the whole page could be
 * swiped sideways on a phone, leaving a blank gutter beside the content. On the
 * mobile traffic this page is built for, that reads as broken.
 *
 * Caught by measuring documentElement.scrollLeft at 390px. It was invisible in
 * a screenshot until the page was deliberately scrolled right.
 */
export default function HowItWorksPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-paper-raised text-ink">
      <header className="mx-auto max-w-3xl px-6 pb-4 pt-14">
        <Link href="/caregivers" style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
          ← Relay for caregivers
        </Link>
        <h1 className="mt-4 font-serif text-t9 font-semibold leading-tight tracking-tight text-ink">
          What actually happens
        </h1>
        <p className="mt-4 text-[19px] leading-relaxed text-ink">
          Most explanations of this kind of product describe features. Here is the sequence instead,
          in the order a family lives it.
        </p>
      </header>

      {/* The narrative. This is the part that makes reversibility mean something. */}
      <section className="mx-auto max-w-3xl px-6 py-8">
        <ol className="space-y-8 border-l border-rule pl-6">
          {TIMELINE.map((step) => (
            <li key={step.title} className="relative">
              <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-ink" />
              <p className="text-t1 font-semibold uppercase tracking-wider text-ochre-text">{step.when}</p>
              <h2 className="mt-1 text-t5 font-semibold text-ink">{step.title}</h2>
              <p className="mt-2 text-[17px] leading-relaxed text-ink">{step.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 rounded-xl border border-ochre bg-ochre-soft p-5 text-[17px] leading-relaxed text-ink">
          <span className="font-semibold">The last step is the one nothing else does.</span> Every
          other way of doing this — a shared note, a deputy, a legacy contact — is a door you open
          once. Relay is the only one that closes again on its own, which is what makes it safe to
          set up before you need it.
        </p>
      </section>

      {/* Use cases. Estate is deliberately absent — see USE_CASES. */}
      <section className="border-y border-rule bg-paper-sunken">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="text-t5 font-semibold tracking-tight text-ink">What people use it for</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {USE_CASES.map((u) => (
              <div key={u.title} className="rounded-xl border border-rule bg-paper-raised p-5">
                <h3 className="font-semibold text-ink">{u.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{u.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Relay is not a will and does not handle inheritance. If that is what you need, an estate
            attorney is the right call — this is about the years before that.
          </p>
        </div>
      </section>

      {/* The matrix. */}
      <section id="compare" className="mx-auto max-w-5xl px-6 py-12 scroll-mt-6">
        <h2 className="text-t5 font-semibold tracking-tight text-ink">How it compares</h2>
        <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-ink">
          These are the four things people actually choose between. We have included the rows we
          lose, because a comparison where the newcomer wins everything is not worth reading.
        </p>

        {/* MOBILE. A five-column table on a 390px screen shows the Relay
            column and hides the other four behind a horizontal swipe nobody
            discovers — so a caregiver saw a row of green dots beside our own
            name and no comparison at all, which reads as bragging rather than
            evidence. Below md the same data renders one block per question,
            with every alternative visible and labelled in words. */}
        <div className="mt-8 space-y-6 md:hidden">
          {ROWS.map((row) => (
            <div key={row.question} className="rounded-xl border border-rule p-4">
              <p className="text-[15px] font-semibold text-ink">{row.question}</p>
              {row.note ? (
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{row.note}</p>
              ) : null}
              <ul className="mt-3 space-y-1.5">
                {COLUMNS.map((c) => (
                  <li
                    key={c.key}
                    className={`flex items-center justify-between gap-3 rounded px-2 py-1 ${
                      c.key === 'relay' ? 'bg-ochre-soft' : ''
                    }`}
                  >
                    <span
                      className={`text-[14px] ${
                        c.key === 'relay' ? 'font-semibold text-ochre-text' : 'text-ink'
                      }`}
                    >
                      {c.label}
                    </span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Mark state={row.cells[c.key]} />
                      <span className="text-[12px] text-muted">
                        {CELL_MARK[row.cells[c.key]].label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Scrolls on a phone rather than squashing five columns. */}
        <div className="mt-8 hidden w-full max-w-full overflow-x-auto md:block">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule-strong">
                <th className="w-[34%] py-3 pr-4 align-bottom text-t2 font-semibold text-ink">
                  &nbsp;
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-3 align-bottom">
                    <div className={`text-t2 font-semibold ${c.key === 'relay' ? 'text-ochre-text' : 'text-ink'}`}>
                      {c.label}
                    </div>
                    <div className="mt-0.5 text-t1 font-normal leading-snug text-muted">{c.sublabel}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.question} className="border-b border-rule align-top">
                  <th scope="row" className="py-4 pr-4 text-left font-normal">
                    <span className="text-[15px] font-medium text-ink">{row.question}</span>
                    {row.note ? (
                      <span className="mt-1 block text-[13px] leading-relaxed text-muted">{row.note}</span>
                    ) : null}
                  </th>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-4 ${c.key === 'relay' ? 'bg-ochre-soft' : ''}`}>
                      <Mark state={row.cells[c.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
          <span><span className="text-sage-text">●</span> yes</span>
          <span><span className="text-ochre-text">◐</span> partly</span>
          <span><span className="text-muted">—</span> not offered</span>
          <span><span className="text-muted">?</span> not published by the vendor</span>
        </div>

        <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
          Checked against vendor documentation on {VERIFIED_ON}. Where a company does not publish
          whether it does something, we say so rather than guessing. If you believe a cell is wrong,
          tell us and we will correct it — these are their products, not ours.
        </p>
      </section>

      <section className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <p className="text-[19px] leading-relaxed text-ink">
            One vault, the whole family, {`$${PRICE_YEARLY_USD}`} a year.
          </p>
          <Link
            href="/caregivers"
            className="mt-6 inline-flex min-h-[48px] items-center rounded-md bg-ink px-6 text-t2 font-semibold text-paper transition-colors hover:bg-ink"
          >
            See Relay for caregivers
          </Link>
        </div>
      </section>
    </main>
  );
}
