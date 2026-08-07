'use client';

/**
 * Owner signup — email, then TOTP enrolment.
 *
 * Two screens, one component. No account exists until the code is verified, so
 * abandoning at the QR step leaves nothing behind (Req 17.1).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

type Phase = 'email' | 'enrol';

/** Base32 in 4-char groups so a 32-character key is typeable by a human. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export default function SignUpForm() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [enrolmentToken, setEnrolmentToken] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onBegin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setPending(false);

    if (!res.ok) {
      setError(data.message ?? 'Could not start signup.');
      return;
    }

    setEnrolmentToken(data.enrolmentToken);
    // The secret is read out of the otpauth URL and never stored elsewhere.
    setSecret(new URL(data.otpauthUrl).searchParams.get('secret') ?? '');
    setPhase('enrol');
  }

  async function onComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const res = await fetch('/api/auth/signup', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrolmentToken, code }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setPending(false);
      setError(data.message ?? 'Could not finish signup.');
      return;
    }

    // Enrolment proved the factor — sign in with the same code.
    const signed = await signIn('email-totp', { email, totpCode: code, redirect: false });
    setPending(false);

    if (signed?.ok) {
      router.push('/start');
      router.refresh();
    } else {
      router.push('/auth/signin');
    }
  }

  if (phase === 'email') {
    return (
      <form onSubmit={onBegin} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Starting…' : 'Continue'}
        </button>

        <p className="text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onComplete} className="space-y-4">
      {/*
        No QR image here on purpose. Rendering one via a hosted QR service would
        send the otpauth URL — which contains the TOTP secret — to a third
        party. A QR belongs here, but only once it is generated client-side.
      */}
      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">Add Relay to your authenticator</p>
        <p className="mt-1 text-xs text-slate-500">
          In 1Password, Authy, Google Authenticator, or any TOTP app, choose
          &ldquo;enter a setup key&rdquo; and paste this:
        </p>

        <code className="mt-2 block break-all rounded bg-white px-2 py-2 text-center text-sm tracking-widest text-slate-800">
          {groupSecret(secret)}
        </code>

        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(secret)}
          className="mt-2 w-full rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-white"
        >
          Copy setup key
        </button>

        <p className="mt-2 text-xs text-slate-500">
          Account name: <span className="text-slate-700">Relay ({email})</span> · time-based · 6
          digits
        </p>
      </div>

      <div>
        <label htmlFor="code" className="mb-1 block text-sm font-medium text-slate-700">
          6-digit code from your authenticator
        </label>
        <input
          id="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={inputClass}
          placeholder="123456"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending || code.length !== 6}
        className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Verifying…' : 'Create account'}
      </button>

      <p className="text-center text-xs text-slate-500">
        Your account is created only once this code checks out.
      </p>
    </form>
  );
}
