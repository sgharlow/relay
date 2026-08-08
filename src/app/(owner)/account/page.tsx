/**
 * /account — leaving (J13).
 *
 * Export and deletion are both written promises: the terms say we will give "a
 * way to export what you have stored", and the privacy page says we will delete
 * the account and vault contents on request. Neither existed, which made both
 * documents inaccurate — and an unfulfilled promise in the legal text of a
 * trust product is worse than the missing feature.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1, J13-R2
 */

import AccountClient from './AccountClient';

export const metadata = { title: 'Your account · Relay' };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your account</h1>
        <p className="mt-1 text-sm text-slate-600">Take your data out, or close the account.</p>
      </div>
      <AccountClient />
    </div>
  );
}
