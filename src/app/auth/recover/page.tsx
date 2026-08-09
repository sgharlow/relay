/**
 * /auth/recover — the way back in after losing the authenticator (J11).
 *
 * Relay has no password, so before this page existed a lost or replaced phone
 * meant a permanently unreachable vault. For an owner in their seventies, over
 * the horizon this product is sold on, that is the expected case.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1
 */

import RecoverForm from './RecoverForm';

export const metadata = {
  title: 'Get back in · Relay',
  robots: { index: false },
};

export default function RecoverPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <div className="w-full rounded-lg border border-rule bg-paper-raised p-6 shadow-sm">
        <RecoverForm />
      </div>
    </main>
  );
}
