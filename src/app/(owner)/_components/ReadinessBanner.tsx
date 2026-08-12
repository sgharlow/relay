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
import { useEffect, useState } from 'react';

import {
  preparednessSentence,
  missingClause,
  type Preparedness,
} from '../../../../lib/vault/preparedness';

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

  useEffect(() => {
    fetch('/api/readiness')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? null))
      .catch(() => setData(null));
  }, []);

  const blockers = data?.blockers ?? null;

  if (!data) return null;

  const fatal = (blockers ?? []).filter((b) => b.fatal);
  const setup = (blockers ?? []).filter((b) => !b.fatal);
  const p = data.preparedness;
  const missing = missingClause(p);

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
