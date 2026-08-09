'use client';

/**
 * Owner sign-in form — email + TOTP (the `email-totp` credentials provider).
 * On success, navigates to the (open-redirect-safe) callbackUrl.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeInternalPath } from '../../../../lib/auth/safe-redirect';

export default function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeInternalPath(params.get('callbackUrl'));

  const [email, setEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn('email-totp', { email, totpCode, redirect: false });
    setPending(false);
    if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    } else {
      setError('Sign-in failed. Check your email and 6-digit authenticator code.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-t2 font-medium text-ink">
          Email address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-rule-strong px-3 py-2 text-t2 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          placeholder="owner@example.com"
        />
      </div>

      <div>
        <label htmlFor="totp" className="mb-1 block text-t2 font-medium text-ink">
          Authenticator code
        </label>
        <input
          id="totp"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="one-time-code"
          required
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded border border-rule-strong px-3 py-2 text-t2 tracking-[0.3em] focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          placeholder="000000"
        />
        <p className="mt-1 text-t1 text-muted">6-digit code from your authenticator app.</p>
      </div>

      {error ? (
        <div role="alert" className="rounded border border-clay bg-clay-soft px-3 py-2 text-t2 text-clay">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-ink px-3 py-2 text-t2 font-semibold text-paper hover:bg-ink disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      {/* The way back for someone whose phone is gone. Relay has no password,
          so without this the only honest answer was "your vault is
          unreachable" — and the person most likely to need it is the one least
          likely to go hunting for it. */}
      <p className="text-center text-t2 text-muted">
        Lost your authenticator?{' '}
        <a href="/auth/recover" className="text-ink hover:underline">
          Use a recovery code
        </a>
      </p>
    </form>
  );
}
