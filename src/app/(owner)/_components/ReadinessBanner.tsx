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

interface Blocker {
  code: string;
  message: string;
  href: string;
  fatal: boolean;
}

export default function ReadinessBanner() {
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);

  useEffect(() => {
    fetch('/api/readiness')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBlockers(d?.blockers ?? []))
      .catch(() => setBlockers([]));
  }, []);

  if (!blockers || blockers.length === 0) return null;

  const fatal = blockers.filter((b) => b.fatal);
  const setup = blockers.filter((b) => !b.fatal);

  return (
    <div className="mb-6 space-y-3">
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

      {setup.length > 0 ? (
        <div style={{ borderRadius: 'var(--radius-owner)', border: '1px solid var(--ochre)', background: 'var(--ochre-soft)', padding: 'var(--s3) var(--s4)' }}>
          <p style={{ fontSize: 'var(--t3)', fontWeight: 600, color: 'var(--ochre-text)' }}>Still to set up</p>
          <ul className="mt-1 space-y-1">
            {setup.map((b) => (
              <li key={b.code} style={{ fontSize: 'var(--t2)', lineHeight: 1.55, color: 'var(--ink-muted)' }}>
                {b.message}{' '}
                <Link href={b.href} className="font-medium underline">
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
