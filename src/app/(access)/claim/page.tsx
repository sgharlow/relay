/**
 * /claim — accept a recipient or verifier role before any trigger fires.
 *
 * Access mode: warm, high contrast, large type (CC8).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R10
 */

import { Suspense } from 'react';
import ClaimClient from './ClaimClient';

export const metadata = { title: 'Your invitation · Relay' };

export default function ClaimPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <ClaimClient />
    </Suspense>
  );
}
