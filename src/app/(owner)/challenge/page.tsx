/**
 * /challenge — the owner answers an access request before verifiers are asked.
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R3, J6-R4
 */

import { Suspense } from 'react';
import ChallengeClient from './ChallengeClient';

export const metadata = { title: 'Someone is asking · Relay' };

export default function ChallengePage() {
  return (
    <Suspense fallback={<p className="text-stone-600">Loading…</p>}>
      <ChallengeClient />
    </Suspense>
  );
}
