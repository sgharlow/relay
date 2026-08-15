'use client';

/**
 * Recovery: email + one recovery code → enrol a new authenticator.
 *
 * Mirrors signup's two phases on purpose. Someone reaching this page has lost
 * their phone and is probably anxious about a vault containing a parent's
 * accounts; the least useful thing to give them is an unfamiliar flow.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1
 */

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { otpauthQrSvg } from '../../../../lib/auth/totp-qr';
import Link from 'next/link';
import { useState } from 'react';

type Phase = 'identify' | 'enrol' | 'done';

const inputCls =
  'mt-1 w-full rounded border border-rule-strong px-3 py-2 text-t3 focus:border-ink focus:outline-none';

export default function RecoverForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('identify');
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [enrolmentToken, setEnrolmentToken] = useState('');
  /*
    🔴 RECOVERY MADE YOU TYPE A 32-CHARACTER KEY BY HAND until 2026-08-13, while
    SIGNUP offered a QR. The otpauth URL was already arriving here — the line
    below used to parse it, take the secret, and throw the rest away — and
    otpauthQrSvg already existed and was already used at signup.

    Who reaches this screen is the argument: somebody whose phone is gone,
    setting up a new one, at a bad moment, and the manual makes the case twice
    that they skew older. Transcribing base32 from one screen to another device
    is the wrong thing to ask of that person when the easy path was two imports
    away.
  */
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(body: unknown) {
    const res = await fetch('/api/auth/recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function onIdentify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { ok, data } = await post({ email, recoveryCode });
    setPending(false);
    if (!ok) {
      setError((data.message as string) ?? 'That did not work.');
      return;
    }
    setEnrolmentToken(data.enrolmentToken as string);
    const url = data.otpauthUrl as string;
    setOtpauthUrl(url);
    setSecret(new URL(url).searchParams.get('secret') ?? '');
    setPhase('enrol');
  }

  // Same construction as signup: the SVG is numeric <rect> coordinates only, so
  // no part of the secret reaches the DOM as text.
  const qrSvg = useMemo(() => (otpauthUrl ? otpauthQrSvg(otpauthUrl) : ''), [otpauthUrl]);

  async function onEnrol(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { ok, data } = await post({ enrolmentToken, code });
    setPending(false);
    if (!ok) {
      setError((data.message as string) ?? 'That code was not valid.');
      return;
    }
    setFresh((data.recoveryCodes as string[]) ?? []);
    setPhase('done');
  }

  if (phase === 'done') {
    return (
      <div>
        <h1 className="text-t7 font-semibold text-ink">You&rsquo;re back in</h1>
        <p className="mt-3 text-t2 leading-relaxed text-ink">
          Your new authenticator is set up. Your old one no longer works, and the recovery codes
          you had before have been replaced — here is a new set.
        </p>
        <ul className="mt-5 grid grid-cols-2 gap-2 rounded-md border border-rule-strong bg-paper-sunken p-4 font-mono text-t2 text-ink">
          {fresh.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => router.push('/auth/signin')}
          className="mt-5 w-full rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (phase === 'enrol') {
    return (
      <form onSubmit={onEnrol}>
        <h1 className="text-t7 font-semibold text-ink">Set up your new authenticator</h1>
        <p className="mt-3 text-t2 leading-relaxed text-ink">
          Scan this with your authenticator app.
        </p>

        {qrSvg ? (
          <div
            className="mx-auto mt-3 w-44 max-w-full rounded bg-paper-raised p-2"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}

        <p className="mt-4 text-t2 leading-relaxed text-ink">
          Cannot scan? Choose &ldquo;enter a setup key&rdquo; instead and type this:
        </p>
        <p className="mt-2 break-all rounded bg-paper-sunken px-3 py-2 font-mono text-t2 text-ink">
          {secret.replace(/(.{4})/g, '$1 ').trim()}
        </p>

        <label htmlFor="code" className="mt-5 block text-t2 font-medium text-ink">
          6-digit code from your new authenticator
        </label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} inputMode="numeric" required />

        {error && <p className="mt-3 text-t2 text-clay">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-5 w-full rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink disabled:opacity-50"
        >
          {pending ? 'Checking…' : 'Finish'}
        </button>
        <p className="mt-3 text-center text-t1 text-muted">
          Nothing changes until this code checks out.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onIdentify}>
      <h1 className="text-t7 font-semibold text-ink">Get back in</h1>
      <p className="mt-3 text-t2 leading-relaxed text-ink">
        Lost the phone with your authenticator? Use one of the recovery codes you saved when you
        created your vault. Your vault contents are untouched — this only replaces how you sign in.
      </p>

      <label htmlFor="email" className="mt-5 block text-t2 font-medium text-ink">
        Email address
      </label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />

      <label htmlFor="recoveryCode" className="mt-4 block text-t2 font-medium text-ink">
        One recovery code
      </label>
      <input
        id="recoveryCode"
        required
        value={recoveryCode}
        onChange={(e) => setRecoveryCode(e.target.value)}
        placeholder="4KMPQ-7XR2W"
        autoCapitalize="characters"
        spellCheck={false}
        className={`${inputCls} font-mono tracking-wide`}
      />

      {error && <p className="mt-3 text-t2 text-clay">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink disabled:opacity-50"
      >
        {pending ? 'Checking…' : 'Continue'}
      </button>

      <p className="mt-4 text-center text-t2 text-muted">
        <Link href="/auth/signin" className="text-ink underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
