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

type Phase = 'email' | 'enrol' | 'recovery';

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
  const [displayName, setDisplayName] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
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
      body: JSON.stringify({ email, displayName }),
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

    if (!signed?.ok) {
      router.push('/auth/signin');
      return;
    }

    // Show the recovery codes BEFORE the vault. Relay has no password, so
    // without these a lost or replaced phone means a permanently unreachable
    // vault — and this is the only moment the owner is guaranteed to be looking.
    // Redirecting straight to /start would bury the one screen that prevents
    // the product's most catastrophic failure.
    if (Array.isArray(data.recoveryCodes) && data.recoveryCodes.length > 0) {
      setRecoveryCodes(data.recoveryCodes as string[]);
      setPhase('recovery');
      return;
    }

    router.push('/start');
    router.refresh();
  }

  if (phase === 'recovery') {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Save these somewhere safe</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-700">
          Relay has no password. If you lose the phone with your authenticator on it, one of these
          codes is the only way back into your vault.
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-700">
          Print them, or put them where you keep important papers.{' '}
          <span className="font-medium">We cannot show them again.</span>
        </p>

        <ul className="mt-5 grid grid-cols-2 gap-2 rounded-md border border-slate-300 bg-slate-50 p-4 font-mono text-[15px] tracking-wide text-slate-900">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
          }}
          className="mt-4 w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Copy all
        </button>

        <button
          type="button"
          onClick={() => {
            router.push('/start');
            router.refresh();
          }}
          className="mt-3 w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          I&rsquo;ve saved them — continue
        </button>
      </div>
    );
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

        {/* OPTIONAL, and asked for here because it is the only place an owner
            can give it. Without a name every message about them prints their
            raw email address — "margaret.chen1948@gmail.com asked you to be a
            trusted contact" — which on a trust product is the strongest
            phishing signal in the outbound mail, and it lands hardest on the
            verifier, who has no stake and is likeliest to bin it. Never
            required: this is the one screen between an ad click and an account. */}
        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-slate-700">
            Your name <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="displayName"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
            placeholder="Margaret Chen"
          />
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            This is how you appear to the people you trust — they will see
            &ldquo;{displayName.trim() || 'your email address'}&rdquo; when we contact them.
          </p>
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
