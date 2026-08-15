/**
 * /break-glass — redeeming the emergency code (§3.6).
 *
 * The last way in, for the contact who never claimed and for the one whose
 * authenticator is gone. Until 2026-08-12 `redeemBreakGlass` existed in `lib`
 * with no route at all, so the designed answer to a lost device could not be
 * exercised by anyone — which is what gated ceasing to mint verifier codes.
 *
 * Access mode: this is read by someone who has already tried the normal way and
 * found it closed, quite possibly during the worst week of their life.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { Suspense } from 'react';

import BreakGlassClient from './BreakGlassClient';

export const metadata = { title: 'Your emergency code · Relay' };

export default function BreakGlassPage() {
  return (
    <Suspense fallback={<p style={{ fontSize: 'var(--t4)', color: '#6b6257' }}>Loading…</p>}>
      <BreakGlassClient />
    </Suspense>
  );
}
