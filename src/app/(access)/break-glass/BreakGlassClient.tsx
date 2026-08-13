'use client';

/**
 * Redeeming an emergency code (§3.6).
 *
 * WHY THE COPY IS SHAPED LIKE THIS. Whoever is reading it has already tried the
 * ordinary way in and found it closed. They may be holding a printed card from
 * years ago, in a hospital corridor, for someone else's account. So: no
 * onboarding, no explanation of what Relay is, one field, and plain language
 * about the one consequence that actually matters to them — that this works
 * once, and the person they are helping will be told.
 *
 * That last part is stated UP FRONT rather than buried. §8.1 accepts a year-old
 * bearer credential only because using it is loud, and someone who would be
 * surprised to learn the owner gets an email should find that out before they
 * type, not after.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function BreakGlassClient() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signIn('break-glass', { code, redirect: false });
      // `ok` explicitly, not merely "no error" — the same care the claim flow
      // needed after a TLS-interception proxy mangled a callback on 2026-08-12
      // and a falsy result read as success.
      if (!res || res.error || res.ok !== true) {
        setError('That code is not valid, or it has already been used.');
        return;
      }
      window.location.href = '/standby';
    } catch {
      setError('We could not check that just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px' }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Use your emergency code
      </h1>
      <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12 }}>
        If you were given a code to keep somewhere safe, type it here. It is the way back in when
        your usual sign-in is not available.
      </p>
      <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 12, color: '#6b6257' }}>
        It works once. The person who gave it to you will be told that you used it, and they will be
        asked to check it was really you — that is deliberate, and it is what makes a code like this
        safe to carry.
      </p>

      <form onSubmit={submit} style={{ marginTop: 24 }}>
        <label
          htmlFor="bg-code"
          style={{ display: 'block', fontSize: 17, fontWeight: 600, marginBottom: 8 }}
        >
          Your emergency code
        </label>
        <input
          id="bg-code"
          value={code}
          onChange={(ev) => setCode(ev.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX"
          style={{
            width: '100%',
            minHeight: 52,
            padding: '0 14px',
            fontSize: 20,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.06em',
            borderRadius: 6,
            border: '1px solid #cfc7ba',
            background: '#fffdf9',
          }}
        />
        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          style={{
            marginTop: 16,
            minHeight: 52,
            width: '100%',
            borderRadius: 6,
            border: '1px solid #211d18',
            background: '#211d18',
            color: '#fffdf9',
            fontSize: 18,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy || code.trim().length === 0 ? 0.6 : 1,
          }}
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      {/*
        🔴 A REJECTED CODE WAS A DEAD END until 2026-08-13. The message named the
        problem and stopped, on the one screen reached exclusively by people
        whose ordinary way in is already gone — the most stuck person in the
        product, told only that the thing in their hand does not work.
        The paragraph below the form covers "I never had a code", which is a
        different situation and does not answer this one. A failure has to say
        what to do next, so this branch names both routes out.
      */}
      {error ? (
        <div role="alert" style={{ marginTop: 16 }}>
          <p style={{ fontSize: 17, color: '#9a3412', lineHeight: 1.6 }}>{error}</p>
          <p style={{ fontSize: 16, marginTop: 8, color: '#6b6257', lineHeight: 1.6 }}>
            Codes are one-use, so a code that worked before will not work again. Ask the person who
            named you for a fresh one — or{' '}
            <a href="/help#code-not-working" style={{ color: '#6b6257' }}>
              read what to do when a code will not work
            </a>
            .
          </p>
        </div>
      ) : null}

      <p style={{ fontSize: 16, lineHeight: 1.6, marginTop: 28, color: '#6b6257' }}>
        No code? Ask the person who named you, if you can reach them — they can issue a new one.
        Relay cannot send you one directly, because a code that arrives in an email is a code anyone
        who reaches that inbox could use.
        {' '}
        If you cannot reach them, that is what the others they named are for: a decision does not
        wait on any one person, and the rest of their circle can still answer without you.
      </p>
    </div>
  );
}
