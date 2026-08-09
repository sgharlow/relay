/**
 * /circle — building the circle of trust.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2, J4-R5, J4-R13
 */

import { Suspense } from 'react';
import CircleClient from './CircleClient';

export const metadata = { title: 'Your circle · Relay' };

export default function CirclePage() {
  return (
    <Suspense fallback={<p className="text-t2 text-muted">Loading…</p>}>
      <CircleClient />
    </Suspense>
  );
}
