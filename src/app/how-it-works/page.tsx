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
      ? 'text-emerald-700'
      : state === 'partial'
        ? 'text-amber-700'
        : state === 'unknown'
          ? 'text-slate-400'
          : 'text-slate-300';
  return (
    <span className={`text-lg ${tone}`} title={label}>
      {mark}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-white text-slate-800">
      <header className="mx-auto max-w-3xl px-6 pb-4 pt-14">
        <Link href="/caregivers" className="text-sm text-slate-500 hover:text-slate-800">
          ← Relay for caregivers
        </Link>
        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900">
          What actually happens
        </h1>
        <p className="mt-4 text-[19px] leading-relaxed text-slate-700">
          Most explanations of this kind of product describe features. Here is the sequence instead,
          in the order a family lives it.
        </p>
      </header>

      {/* The narrative. This is the part that makes reversibility mean something. */}
      <section className="mx-auto max-w-3xl px-6 py-8">
        <ol className="space-y-8 border-l border-slate-200 pl-6">
          {TIMELINE.map((step) => (
            <li key={step.title} className="relative">
              <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">{step.when}</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{step.title}</h2>
              <p className="mt-2 text-[17px] leading-relaxed text-slate-700">{step.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 rounded-xl border border-amber-300 bg-amber-50 p-5 text-[17px] leading-relaxed text-slate-800">
          <span className="font-semibold">The last step is the one nothing else does.</span> Every
          other way of doing this — a shared note, a deputy, a legacy contact — is a door you open
          once. Relay is the only one that closes again on its own, which is what makes it safe to
          set up before you need it.
        </p>
      </section>

      {/* Use cases. Estate is deliberately absent — see USE_CASES. */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">What people use it for</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {USE_CASES.map((u) => (
              <div key={u.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold text-slate-900">{u.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{u.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-500">
            Relay is not a will and does not handle inheritance. If that is what you need, an estate
            attorney is the right call — this is about the years before that.
          </p>
        </div>
      </section>

      {/* The matrix. */}
      <section id="compare" className="mx-auto max-w-5xl px-6 py-12 scroll-mt-6">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">How it compares</h2>
        <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-slate-700">
          These are the four things people actually choose between. We have included the rows we
          lose, because a comparison where the newcomer wins everything is not worth reading.
        </p>

        {/* Scrolls on a phone rather than squashing five columns. */}
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="w-[34%] py-3 pr-4 align-bottom text-sm font-semibold text-slate-900">
                  &nbsp;
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-3 align-bottom">
                    <div className={`text-sm font-semibold ${c.key === 'relay' ? 'text-amber-700' : 'text-slate-900'}`}>
                      {c.label}
                    </div>
                    <div className="mt-0.5 text-xs font-normal leading-snug text-slate-500">{c.sublabel}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.question} className="border-b border-slate-200 align-top">
                  <th scope="row" className="py-4 pr-4 text-left font-normal">
                    <span className="text-[15px] font-medium text-slate-900">{row.question}</span>
                    {row.note ? (
                      <span className="mt-1 block text-[13px] leading-relaxed text-slate-500">{row.note}</span>
                    ) : null}
                  </th>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-4 ${c.key === 'relay' ? 'bg-amber-50/60' : ''}`}>
                      <Mark state={row.cells[c.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-500">
          <span><span className="text-emerald-700">●</span> yes</span>
          <span><span className="text-amber-700">◐</span> partly</span>
          <span><span className="text-slate-300">—</span> not offered</span>
          <span><span className="text-slate-400">?</span> not published by the vendor</span>
        </div>

        <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-slate-500">
          Checked against vendor documentation on {VERIFIED_ON}. Where a company does not publish
          whether it does something, we say so rather than guessing. If you believe a cell is wrong,
          tell us and we will correct it — these are their products, not ours.
        </p>
      </section>

      <section className="border-t border-slate-200">
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <p className="text-[19px] leading-relaxed text-slate-800">
            One vault, the whole family, {`$${PRICE_YEARLY_USD}`} a year.
          </p>
          <Link
            href="/caregivers"
            className="mt-6 inline-flex min-h-[48px] items-center rounded-md bg-amber-500 px-6 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
          >
            See Relay for caregivers
          </Link>
        </div>
      </section>
    </main>
  );
}
