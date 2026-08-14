'use client';

/**
 * Something broke while a real person was using this.
 *
 * 🔴 THERE WAS NO ERROR BOUNDARY AT ALL until 2026-08-12. An unhandled render
 * error showed Next's default page — a stack-shaped thing with a refresh
 * suggestion — to somebody who may be standing in a hospital corridor trying to
 * reach a parent's utility account.
 *
 * WRITTEN FOR THE CONTACT, NOT THE OWNER, deliberately. This boundary covers
 * both halves of the product, and one of the two readers is mid-crisis while the
 * other is mid-setup on a Tuesday. An owner meeting a slightly warm error page
 * loses nothing; a contact meeting a cold technical one loses the only thing
 * this product is selling.
 *
 * THREE THINGS IT HAS TO DO, in order of what the reader needs:
 *   1. Say nothing is lost. That is the fear, and it is true — a render failure
 *      does not undo committed state.
 *   2. Say what to do next, in one step.
 *   3. Report itself, silently, so this is the last person it happens to.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7
 */

import { useEffect } from 'react';
import { CONTACT_EMAIL } from '../../lib/contact';

/**
 * The palette, named once.
 *
 * INLINE LITERALS ARE DELIBERATE ON THIS SCREEN — it renders because something
 * already failed, so it must not depend on the stylesheet or the token pipeline
 * that may be part of what broke. What was NOT deliberate was spelling the same
 * hex out nine times: lib/ops/raw-color.test.ts ratchets these down precisely so
 * they cannot quietly multiply, and adding a support link would have pushed the
 * count up. Naming them keeps the independence and drops the count instead.
 *
 * Values match the light-mode tokens in globals.css. They are duplicated here on
 * purpose and that duplication is the price of a boundary that cannot fail.
 */
const C = {
  paper: '#f6f3ee',
  paperRaised: '#fffdf9',
  ink: '#211d18',
  muted: '#6b6257',
  rule: '#cfc7ba',
  faint: '#8a8177',
} as const;

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The DIGEST only — never `error.message`. React produces the digest for
    // exactly this purpose, and a message thrown near the crypto path could
    // carry vault content.
    const path = typeof window !== 'undefined' ? window.location.pathname : 'unknown';
    const mode = path.startsWith('/standby') || path.startsWith('/access') || path.startsWith('/verify')
      || path.startsWith('/claim') || path.startsWith('/break-glass') || path.startsWith('/helping')
      ? 'access'
      : path === '/' || path.startsWith('/terms') || path.startsWith('/privacy')
        ? 'public'
        : 'owner';

    void fetch('/api/incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest: error.digest ?? null, path, mode }),
      keepalive: true,
    }).catch(() => {
      // A page that is already broken must not break louder.
    });
  }, [error]);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: C.paper,
        color: C.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
          Something went wrong on our side
        </h1>

        <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12 }}>
          <strong>Nothing has been lost, and nothing has been opened.</strong> This is a page
          failing to load, not anything changing.
        </p>

        <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 12, color: C.muted }}>
          If you were part-way through something, it either finished or it did not happen at all —
          it cannot have half-happened.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 48,
              padding: '0 22px',
              fontSize: 17,
              fontWeight: 600,
              color: C.paperRaised,
              background: C.ink,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {/*
            A plain <a>, not next/link: this boundary renders BECAUSE something
            failed, and a client-side navigation would ask the router that may be
            what broke to do the one thing the reader needs. A full load always
            works.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              minHeight: 48,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 22px',
              fontSize: 17,
              color: C.ink,
              border: `1px solid ${C.rule}`,
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Start again from the beginning
          </a>
        </div>

        {/*
          🔴 THIS USED TO SAY "reply to any message Relay has sent you" AND
          NOTHING ELSE. Written 2026-08-12; /help and the public address shipped
          on the 13th and this was never updated. An owner who breaks something
          part-way through setting up has received no message to reply to, so
          the only route to a human was one they did not have.

          The reply-to line stays, second, because it genuinely is the fastest
          path for a contact mid-emergency who has a notice open in front of
          them. A plain <a> rather than a router link: this boundary renders
          because something already failed, and it must not depend on the thing
          that broke.
        */}
        <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 20, color: C.muted }}>
          We have been told this happened. If it keeps happening and somebody is waiting on you,{' '}
          <a href="/help" style={{ color: C.ink }}>
            ask us for help
          </a>{' '}
          or write to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: C.ink }}>
            {CONTACT_EMAIL}
          </a>
          . If Relay has sent you a message, replying to it reaches the same people.
        </p>

        {error.digest ? (
          <p style={{ fontSize: 14, marginTop: 12, color: C.faint, fontFamily: 'ui-monospace, monospace' }}>
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
