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
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="owner@example.com"
        />
      </div>

      <div>
        <label htmlFor="totp" className="mb-1 block text-sm font-medium text-slate-700">
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
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm tracking-[0.3em] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="000000"
        />
        <p className="mt-1 text-xs text-slate-500">6-digit code from your authenticator app.</p>
      </div>

      {error ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
