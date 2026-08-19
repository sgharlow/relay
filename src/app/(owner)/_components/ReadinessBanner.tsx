'use client';

/**
 * The standing answer to "will this actually work when I need it?"
 *
 * Shown on every owner screen because the failure it reports is invisible
 * everywhere else: a vault with no trusted contact renders exactly like a
 * working one — green ARMED badge, rules listed, recipient listed — and only
 * reveals itself during the emergency, by not opening.
 *
 * Fatal blockers are red and unmissable. Non-fatal ones are setup-in-progress,
 * not faults, and are worded that way; nagging a new owner about an empty vault
 * on their first minute is how a banner gets ignored, and this one has to be
 * believed on the day it matters.
 *
 * Feature: relay-h0-mvp
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  preparednessSentence,
  missingClause,
  undeclaredClause,
  type Preparedness,
} from '../../../../lib/vault/preparedness';
import { onFactorsDeclared, setFactorsRequired } from '../../../../lib/vault/declare-factors';

interface Blocker {
  code: string;
  message: string;
  href: string;
  fatal: boolean;
}

interface Readiness {
  blockers: Blocker[];
  preparedness: Preparedness;
  whoLabel: string;
  /** [A3] §4.5 — can the plan RUN, and the one thing to do if not. */
  circle?: {
    light: 'red' | 'amber' | 'green';
    executable: boolean;
    nextAction: string | null;
  };
}

export default function ReadinessBanner() {
  const [data, setData] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  /*
    Extracted so answering the prompt below can re-read it. The sentence and the
    prompt are the same measurement, so an answer that did not move the sentence
    would look exactly like an answer that failed to save.
  */
  const load = useCallback(() => {
    return fetch('/api/readiness')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? null))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    The vault row carries the same control, and it lives on a page that is a
    sibling of this layout — no shared provider, no shared state. Without this
    the sentence above kept its pre-answer wording after an owner answered on
    the row, which is the worse half of the defect: the surface this component's
    own comments call authoritative would be the stale one.
  */
  useEffect(() => onFactorsDeclared(() => void load()), [load]);

  /**
   * 🔴 THE POINT OF D3. The control that records this has existed on the vault
   * row since 2026-08-18 and nothing ASKED — so it was reachable only by an
   * owner already looking at the item they would have had to doubt first, and
   * every item created before that date reads `unknown`, which suppresses the
   * qualifier on the sentence above. For every plan that already existed, the
   * headline claim stayed exactly as wrong as it was before the column shipped.
   *
   * Both answers are offered with equal weight. A prompt that only ever offers
   * the alarming answer teaches the owner it is an accusation, and "a password
   * is enough" is the answer most items will get — it is also the one that
   * turns an unknown into a usable item rather than into more doubt.
   */
  async function answer(itemId: string, needsCode: boolean) {
    setBusy(true);
    setAnswerError(null);
    try {
      await setFactorsRequired(itemId, needsCode ? ['totp'] : []);
      await load();
    } catch (e) {
      setAnswerError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const blockers = data?.blockers ?? null;

  if (!data) return null;

  const fatal = (blockers ?? []).filter((b) => b.fatal);
  const setup = (blockers ?? []).filter((b) => !b.fatal);
  const p = data.preparedness;
  const missing = missingClause(p);
  const undeclared = undeclaredClause(p);

  /**
   * STRUCTURAL GUARD, added 2026-08-12 alongside the fix to what `ready`
   * counts. Sage is refused whenever a fatal blocker exists, whatever the
   * preparedness calculation concluded.
   *
   * The calculation was fixed in `readiness.ts`; this makes the bad state
   * IMPOSSIBLE rather than merely currently-absent. A green statement sitting
   * directly above "This vault would not open in an emergency" is the worst
   * output this component can produce, and it should not depend on every future
   * change to a separate module getting its arithmetic right. Safety by
   * structure, not by convention.
   */
  const green = p.ready && fatal.length === 0;

  return (
    <div className="mb-6 space-y-3">
      {/*
        The standing statement, on every owner screen. The blockers below say
        what is absent; this says what the absence costs — which is the only
        number an owner of a preparedness product should have to care about.

        Sage when everything that matters is reachable, ochre when it is not.
        Never clay: an incomplete vault is not a permanent condition, and
        spending clay here would leave nothing to mark the estate handoff.
      */}
      <div
        style={{
          borderRadius: 'var(--radius-owner)',
          border: `1px solid ${green ? 'var(--sage)' : 'var(--ochre)'}`,
          background: green ? 'var(--sage-soft)' : 'var(--ochre-soft)',
          padding: 'var(--s3) var(--s4)',
        }}
      >
        <p style={{ fontSize: 'var(--t3)', fontWeight: 600, color: green ? 'var(--sage-text)' : 'var(--ink)' }}>
          {preparednessSentence(p, data.whoLabel)}
        </p>
        {missing ? (
          <p style={{ fontSize: 'var(--t2)', lineHeight: 1.55, color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
            {missing}
          </p>
        ) : null}
        {/*
          The question, asked where the claim it corrects is made. Named items
          rather than a count, because "2 of them" is not something an owner can
          act on without first going to find out which two — which is the
          having-to-find-it problem this prompt exists to remove.

          Capped at two by `assessPreparedness` (NAME_LIMIT): a list of nine is
          not a prompt, it is a wall. Answering one reveals the next.
        */}
        {p.unaskedItems.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--s2) 0 0' }} className="space-y-1">
            {p.unaskedItems.map((it) => (
              <li
                key={it.id}
                className="flex flex-wrap items-center"
                style={{ gap: 'var(--s2)', fontSize: 'var(--t2)', color: 'var(--ink)' }}
              >
                <span style={{ fontWeight: 500 }}>{it.title}</span>
                {/*
                  Both controls carry a real box — 24x24 minimum, WCAG 2.5.8,
                  the same rule the "Go" link below was corrected for on
                  2026-08-12. A quiet text button inside a banner is the easiest
                  place in this product to reintroduce that defect.
                */}
                <button
                  type="button"
                  onClick={() => answer(it.id, true)}
                  disabled={busy}
                  aria-label={`${it.title} asks for a code as well as a password`}
                  className="inline-block min-h-[24px] px-2 py-0.5"
                  style={{
                    fontSize: 'var(--t1)',
                    borderRadius: 4,
                    border: '1px solid var(--ochre)',
                    color: 'var(--ochre-text)',
                    background: 'transparent',
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  Needs a code
                </button>
                <button
                  type="button"
                  onClick={() => answer(it.id, false)}
                  disabled={busy}
                  aria-label={`A password is enough for ${it.title}`}
                  className="inline-block min-h-[24px] px-2 py-0.5"
                  style={{
                    fontSize: 'var(--t1)',
                    borderRadius: 4,
                    border: '1px solid var(--rule-strong)',
                    color: 'var(--ink)',
                    background: 'transparent',
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  Password is enough
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {/*
          The other half, and it is NOT a question. These are items the owner has
          already answered, where no client ever declared what the entry holds —
          which is every item created before 2026-08-18. No tap can resolve them:
          Relay cannot read the entry, and an update replaces the payload rather
          than editing it, so re-saving the item is the only act that records
          what it holds. A button here would be one that cannot work.
        */}
        {undeclared ? (
          <p style={{ fontSize: 'var(--t2)', lineHeight: 1.55, color: 'var(--ink-muted)', marginTop: 'var(--s2)' }}>
            {undeclared}{' '}
            <Link href="/vault" className="inline-block min-h-[24px] px-1 py-0.5 font-medium underline">
              Open your vault
            </Link>
          </p>
        ) : null}
        {answerError ? (
          <p role="alert" style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: 'var(--s1)' }}>
            {answerError}
          </p>
        ) : null}
      </div>
      {fatal.length > 0 ? (
        <div style={{ borderRadius: 'var(--radius-owner)', border: '1px solid var(--clay)', background: 'var(--clay-soft)', padding: 'var(--s3) var(--s4)' }}>
          <p style={{ fontSize: 'var(--t3)', fontWeight: 600, color: 'var(--ink)' }}>This vault would not open in an emergency.</p>
          <ul className="mt-2 space-y-1">
            {fatal.map((b) => (
              <li key={b.code} style={{ fontSize: 'var(--t2)', lineHeight: 1.55, color: 'var(--ink)' }}>
                {b.message}{' '}
                <Link href={b.href} className="font-medium underline">
                  Fix this
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        [A3] §4.5 — the one thing to do next, shown only when the plan cannot
        run and there is no FATAL blocker already saying something louder.
        Suppressed alongside a fatal one on purpose: two red-ish paragraphs
        competing for the same attention is how a banner becomes wallpaper, and
        the fatal message is the more urgent of the two.

        This is deliberately an ACTION, not a colour. "A status light that does
        not say what to do is the amber owners learn to ignore, just with more
        colours."
      */}
      {fatal.length === 0 && data.circle && !data.circle.executable && data.circle.nextAction ? (
        <div
          style={{
            borderRadius: 'var(--radius-owner)',
            border: '1px solid var(--ochre)',
            background: 'var(--ochre-soft)',
            padding: 'var(--s3) var(--s4)',
          }}
        >
          <p style={{ fontSize: 'var(--t3)', fontWeight: 600, color: 'var(--ochre-text)' }}>
            Your plan cannot run yet
          </p>
          <p style={{ fontSize: 'var(--t2)', lineHeight: 1.55, color: 'var(--ink)', marginTop: 'var(--s1)' }}>
            {data.circle.nextAction}{' '}
            <Link href="/circle" className="font-medium underline">
              Go to your circle
            </Link>
          </p>
        </div>
      ) : null}

      {setup.length > 0 ? (
        <div style={{ borderRadius: 'var(--radius-owner)', border: '1px solid var(--ochre)', background: 'var(--ochre-soft)', padding: 'var(--s3) var(--s4)' }}>
          <p style={{ fontSize: 'var(--t3)', fontWeight: 600, color: 'var(--ochre-text)' }}>Still to set up</p>
          <ul className="mt-1 space-y-1">
            {setup.map((b) => (
              <li key={b.code} style={{ fontSize: 'var(--t2)', lineHeight: 1.55, color: 'var(--ink-muted)' }}>
                {b.message}{' '}
                {/*
                  Measured at 18x17 on 2026-08-12, below WCAG 2.5.8's 24x24
                  minimum — the same defect as the three owner controls fixed in
                  August, missed then because this link only renders when a
                  NON-FATAL blocker exists. `inline-block` plus padding gives it
                  a real box without changing how the sentence reads.
                */}
                <Link
                  href={b.href}
                  className="inline-block min-h-[24px] px-1 py-0.5 font-medium underline"
                >
                  Go
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
