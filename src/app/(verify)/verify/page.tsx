/**
 * /verify — the verifier's decision page. No account required (J7-R1).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1, J7-R3, J7-R6
 */

import { Suspense } from 'react';
import VerifyClient from './VerifyClient';

export const metadata = { title: 'A quick question · Relay' };

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-stone-600">Loading…</p>}>
      <VerifyClient />
    </Suspense>
  );
}
