/**
 * Sign-in page (Requirement 17.1). Server shell wrapping the client form in a
 * Suspense boundary (required for useSearchParams in the App Router).
 *
 * Feature: relay-h0-mvp
 */

import { Suspense } from 'react';
import SignInForm from './SignInForm';

export const metadata = { title: 'Sign in · Relay' };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-sunken px-4 text-ink">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-paper-raised p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-t5 font-semibold tracking-tight">Relay</div>
          <h1 className="mt-1 text-t7 font-semibold">Owner sign in</h1>
          <p className="mt-1 text-t2 text-muted">Multi-factor sign-in is required.</p>
        </div>
        <Suspense fallback={<p className="text-t2 text-muted">Loading…</p>}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
