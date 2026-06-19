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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-lg font-semibold tracking-tight">Relay</div>
          <h1 className="mt-1 text-xl font-semibold">Owner sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Multi-factor sign-in is required.</p>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
