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
        background: '#f6f3ee',
        color: '#211d18',
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

        <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 12, color: '#6b6257' }}>
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
              color: '#fffdf9',
              background: '#211d18',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              minHeight: 48,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 22px',
              fontSize: 17,
              color: '#211d18',
              border: '1px solid #cfc7ba',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Start again from the beginning
          </a>
        </div>

        <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 20, color: '#6b6257' }}>
          We have been told this happened. If it keeps happening and somebody is waiting on you,
          reply to any message Relay has sent you — a person reads that.
        </p>

        {error.digest ? (
          <p style={{ fontSize: 14, marginTop: 12, color: '#8a8177', fontFamily: 'ui-monospace, monospace' }}>
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
