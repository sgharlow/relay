/**
 * Auth error page (NextAuth `pages.error`). Server shell + Suspense for the
 * client error reader.
 *
 * Feature: relay-h0-mvp
 */

import { Suspense } from 'react';
import ErrorContent from './ErrorContent';

export const metadata = { title: 'Sign-in error · Relay' };

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <ErrorContent />
      </Suspense>
    </main>
  );
}
