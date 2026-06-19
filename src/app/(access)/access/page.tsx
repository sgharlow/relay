/**
 * Access page (Requirement 7 / task 22.2). Server shell + Suspense for the
 * client dashboard (useSearchParams reads the recipient token from `?token=`).
 *
 * Feature: relay-h0-mvp
 */

import { Suspense } from 'react';
import AccessClient from './AccessClient';

export default function AccessPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
      <AccessClient />
    </Suspense>
  );
}
