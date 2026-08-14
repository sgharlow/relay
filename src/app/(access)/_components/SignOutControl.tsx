'use client';

/**
 * The way to end a session, in the mode that never had one.
 *
 * 🔴 THERE WAS NO SIGN-OUT ANYWHERE IN THE PRODUCT until 2026-08-13 — not in
 * owner mode, not here. `grep -rn signOut src/` returned nothing. A session
 * simply lasted until its 24 hours ran out, wherever it had been opened.
 *
 * It matters MOST in this mode. The standby audience is exactly the population
 * that uses a shared family computer, a library machine, or a borrowed phone —
 * and a claimed contact's session IS their identity here. Walking away from a
 * kitchen laptop with /standby still signed in leaves "Ask Margaret to open it"
 * one click away for whoever sits down next.
 *
 * Rendered ONLY when a session actually exists. The access layout also serves
 * /claim and /break-glass, whose visitors are signed OUT by definition —
 * offering them "Sign out" would be asking a person mid-crisis to wonder what
 * they are signed in to. The session probe is next-auth's own endpoint, which
 * answers `{}` when there is nobody; nothing renders until it says otherwise.
 *
 * This does not contradict the layout's "chrome: none" rule, for the same
 * reason SupportFooter does not: it is not a destination. Nothing about it
 * invites exploration — it is the digital equivalent of locking the door on
 * the way out.
 */

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

export default function SignOutControl() {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && s && Object.keys(s).length > 0) setHasSession(true);
      })
      .catch(() => {
        // No session probe, no control. Absent is the safe default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hasSession) return null;

  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: '/' })}
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--t1)',
        color: 'var(--ink-muted)',
        textDecoration: 'underline',
        textUnderlineOffset: '3px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        // The label is small; the target must not be. 44px is the floor the
        // rest of the product holds.
        minHeight: 44,
        padding: '0 var(--s2)',
      }}
    >
      Sign out
    </button>
  );
}
