/**
 * /helping — the workspace for somebody setting up another person's vault.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R4, J3-R6
 */

import { Suspense } from 'react';

import HelpingClient from './HelpingClient';

export const metadata = { title: 'Helping · Relay' };

export default function HelpingPage() {
  return (
    <Suspense fallback={<p style={{ fontSize: 17, color: '#6b6257' }}>Loading…</p>}>
      <HelpingClient />
    </Suspense>
  );
}
