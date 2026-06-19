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
    <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Sign-in error</h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <Link href="/auth/signin" className="mt-4 inline-block rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
        Back to sign in
      </Link>
    </div>
  );
}
