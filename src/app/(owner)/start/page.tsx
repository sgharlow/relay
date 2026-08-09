/**
 * /start — the first-run flow a new owner lands on after signup.
 *
 * Server shell; the seed → reveal → price sequence is client-side because the
 * seed encrypts in the browser (CC1).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R4, J1-R5, J1-R6
 */

import { Suspense } from 'react';
import StartClient from './StartClient';

export const metadata = { title: 'Start your vault · Relay' };

export default function StartPage() {
  return (
    <Suspense fallback={<p style={{ fontSize: 'var(--t3)', color: 'var(--ink-muted)' }}>Loading…</p>}>
      <StartClient />
    </Suspense>
  );
}
