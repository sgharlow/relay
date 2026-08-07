/**
 * Signup page (Requirement 17.1, J1-R3). Server shell wrapping the client form
 * in a Suspense boundary, matching the sign-in page's structure.
 *
 * Feature: relay-g1-wtp
 */

import { Suspense } from 'react';
import SignUpForm from './SignUpForm';

export const metadata = { title: 'Create your vault · Relay' };

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-lg font-semibold tracking-tight">Relay</div>
          <h1 className="mt-1 text-xl font-semibold">Create your vault</h1>
          <p className="mt-1 text-sm text-slate-500">
            Two steps. An authenticator app is required — there is no password.
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <SignUpForm />
        </Suspense>
      </div>
    </main>
  );
}
