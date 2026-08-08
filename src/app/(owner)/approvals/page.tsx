/**
 * /approvals — the parent's approval queue for delegate proposals.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6, J3-R9
 */

import { Suspense } from 'react';
import ApprovalsClient from './ApprovalsClient';

export const metadata = { title: 'Waiting for you · Relay' };

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<p className="text-stone-600">Loading…</p>}>
      <ApprovalsClient />
    </Suspense>
  );
}
