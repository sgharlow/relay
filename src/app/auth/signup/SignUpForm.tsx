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

import { RECOVERY_CODE_COUNT } from '../../../../lib/auth/recovery-code-count';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

import { otpauthQrSvg } from '../../../../lib/auth/totp-qr';

type Phase = 'email' | 'enrol' | 'recovery';

/** Base32 in 4-char groups so a 32-character key is typeable by a human. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

const inputClass =
  'w-full rounded border border-rule-strong px-3 py-2 text-t2 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink';

export default function SignUpForm() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  // Set when the visitor arrived by pressing "Set up my vault now" rather than
  // browsing in. They intend to pay, so the last screen sends them to Stripe
  // instead of the vault.
  const [buyIntent, setBuyIntent] = useState(false);
  const [enrolmentToken, setEnrolmentToken] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Read in an effect rather than from useSearchParams so this page stays
  // statically renderable — the same reason the funnel trackers do it.
  useEffect(() => {
    setBuyIntent(new URLSearchParams(window.location.search).get('next') === 'checkout');
  }, []);

  // Encoding is pure and fast, but it runs on every keystroke in the code field
  // without this — and a wrong-looking QR mid-typing is the kind of thing that
  // makes someone start over.
  const qrSvg = useMemo(() => (otpauthUrl ? otpauthQrSvg(otpauthUrl) : ''), [otpauthUrl]);

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
    setOtpauthUrl(data.otpauthUrl);
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
        <h1 className="text-t7 font-semibold text-ink">Save these somewhere safe</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink">
          Relay has no password. If you lose the phone with your authenticator on it, one of these
          codes is the only way back into your vault.
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">
          Print them, or put them where you keep important papers.{' '}
          <span className="font-medium">We cannot show them again.</span>
        </p>

        <ul className="mt-5 grid grid-cols-2 gap-2 rounded-md border border-rule-strong bg-paper-sunken p-4 font-mono text-[15px] tracking-wide text-ink">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
          }}
          className="mt-4 w-full rounded border border-rule-strong px-3 py-2 text-t2 font-medium text-ink hover:bg-paper-sunken"
        >
          Copy all
        </button>

        <button
          type="button"
          onClick={async () => {
            // Recovery codes are shown FIRST even for a buyer — losing the
            // authenticator is unrecoverable, and that screen must not be
            // skipped by someone in a hurry to pay.
            if (buyIntent) {
              try {
                const res = await fetch('/api/stripe/checkout', { method: 'POST' });
                if (res.ok) {
                  const { url } = (await res.json()) as { url?: string };
                  if (url) {
                    window.location.href = url;
                    return;
                  }
                }
              } catch {
                /* fall through to the vault rather than stranding them */
              }
            }
            router.push('/start');
            router.refresh();
          }}
          className="mt-3 w-full rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink"
        >
          {buyIntent ? 'I’ve saved them — continue to payment' : 'I’ve saved them — continue'}
        </button>
      </div>
    );
  }

  if (phase === 'email') {
    return (
      <form onSubmit={onBegin} className="space-y-4">
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
          <label htmlFor="displayName" className="mb-1 block text-t2 font-medium text-ink">
            Your name <span className="font-normal text-muted">(optional)</span>
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
          <p className="mt-1 text-t1 leading-relaxed text-muted">
            This is how you appear to the people you trust — they will see
            &ldquo;{displayName.trim() || 'your email address'}&rdquo; when we contact them.
          </p>
        </div>

        {error && <p className="text-t2 text-clay">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink disabled:opacity-50"
        >
          {pending ? 'Starting…' : 'Continue'}
        </button>

        <p className="text-center text-t2 text-muted">
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-ink underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onComplete} className="space-y-4">
      {/*
        The QR is generated in this browser — see lib/auth/totp-qr.ts. A hosted
        QR service would have sent the otpauth URL, and with it the TOTP secret,
        to a third party; that ruled out the obvious implementation, not the
        capability. The typed setup key stays below it, because scanning fails
        on a desktop with no camera and on a phone signing up for itself.
      */}
      <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--radius-owner)', background: 'var(--paper-sunken)', padding: 'var(--s4)' }}>
        {/*
          Names the reason, not the mechanism. "Enrol a TOTP factor" is what the
          system is doing; "a password alone can be phished, and this vault holds
          your family's accounts" is why anyone should bother. The step is the
          most common place to abandon signup, and it is abandoned because it
          feels like homework rather than protection.
        */}
        <p style={{ fontSize: 'var(--t3)', fontWeight: 600 }}>
          Now the part that makes this vault worth trusting
        </p>
        <p style={{ fontSize: 'var(--t2)', lineHeight: 1.6, color: 'var(--ink-muted)', marginTop: 'var(--s2)' }}>
          A password on its own can be phished, and this vault holds your family&rsquo;s accounts.
          Scan this once with an authenticator app and nobody can get in with your password alone —
          not an attacker, and not us.
        </p>

        {qrSvg ? (
          <div
            className="mx-auto mt-3 w-44 max-w-full rounded bg-paper-raised p-2"
            /*
              Safe by construction, not by trust: otpauthQrSvg emits only an
              <svg> of numeric <rect> coordinates. The payload is encoded into
              the module matrix, never interpolated into markup, so no part of
              the email or secret reaches the DOM as text. A test pins that.
            */
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}

        <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s3)' }}>
          No app yet? Google Authenticator and 1Password are both free and take about a minute.
          Can&rsquo;t scan? Choose &ldquo;enter a setup key&rdquo; and type this instead:
        </p>

        <code className="mt-2 block break-all rounded bg-paper-raised px-2 py-2 text-center text-t2 tracking-widest text-ink">
          {groupSecret(secret)}
        </code>

        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(secret)}
          className="mt-2 w-full rounded border border-rule-strong px-3 py-1.5 text-t1 text-muted hover:bg-paper-raised"
        >
          Copy setup key
        </button>

        <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-faint)', marginTop: 'var(--s2)' }}>
          Account name: <span style={{ color: 'var(--ink-muted)' }}>Relay ({email})</span> ·
          time-based · 6 digits
        </p>
      </div>

      {/*
        Said here rather than discovered later. This is the one place where
        losing a phone is genuinely a problem, and a product about continuity
        that hides its own failure mode has not earned the trust it is asking
        for. Better to say it now than at 2am.
      */}
      {/*
        🔴 THIS SAID "ten recovery codes" AND THE PRODUCT ISSUES EIGHT.
        RECOVERY_CODE_COUNT has been 8; the promise was never updated. Found by
        signing up on production on 2026-08-14 and counting what arrived.

        A two-off miscount would be trivial anywhere else. Here it is on the
        screen explaining the ONLY way back into a vault nobody — us included —
        can otherwise open, being read by someone deciding whether to trust us
        with their family's accounts. Getting a smaller number than promised, at
        exactly that moment, is the kind of small wrongness that makes a careful
        person wonder what else is approximate.

        Now derived from the constant, so the sentence cannot drift from the
        code again.
      */}
      <p style={{ fontSize: 'var(--t2)', lineHeight: 1.6, color: 'var(--ink-muted)' }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>If you lose your phone:</span> we
        give you {RECOVERY_CODE_COUNT} recovery codes on the next screen. Print them, or put them
        somewhere you keep important paper. They are the only way back in.
      </p>

      <div>
        <label htmlFor="code" style={{ display: 'block', fontSize: 'var(--t2)', fontWeight: 500, marginBottom: 'var(--s1)' }}>
          Then type the 6 digits it shows you
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

      {error && <p className="text-t2 text-clay">{error}</p>}

      <button
        type="submit"
        disabled={pending || code.length !== 6}
        className="w-full rounded bg-ink px-3 py-2 text-t2 font-medium text-paper hover:bg-ink disabled:opacity-50"
      >
        {pending ? 'Verifying…' : 'Create account'}
      </button>

      <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-faint)', textAlign: 'center' }}>
        Nothing is saved until this code checks out — abandon here and no account exists.
      </p>
    </form>
  );
}
