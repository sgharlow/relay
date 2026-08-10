'use client';

/** Reads the NextAuth ?error= code and shows a friendly message. */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Those credentials were not accepted. Check your email and authenticator code.',
  Configuration: 'Sign-in is misconfigured. Please contact the administrator.',
  AccessDenied: 'Access denied.',
  Verification: 'This sign-in link is no longer valid.',
};

export default function ErrorContent() {
  const code = useSearchParams().get('error') ?? '';
  const message = MESSAGES[code] ?? 'Something went wrong during sign-in.';
  return (
    <div className="w-full max-w-sm rounded-lg border border-rule bg-paper-raised p-6 text-center shadow-sm">
      <h1 className="text-t7 font-semibold text-ink">Sign-in error</h1>
      <p className="mt-2 text-t2 text-muted">{message}</p>
      <Link href="/auth/signin" className="mt-4 inline-block rounded bg-ink px-3 py-2 text-t2 font-semibold text-paper hover:bg-ink">
        Back to sign in
      </Link>
    </div>
  );
}
