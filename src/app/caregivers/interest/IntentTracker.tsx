'use client';

/**
 * G1 WTP instrument — fires the NUMERATOR event (intent) once on mount when a visitor lands
 * on /caregivers/interest with the price already seen, tagged with `?src=`. Reads
 * window.location.search directly so the page stays statically renderable (no Suspense).
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import { useEffect } from 'react';

import { CAREGIVER_INTENT, intentProps, recallChannel } from '../analytics';
import { trackG1 } from '../track';

export default function IntentTracker() {
  useEffect(() => {
    // src = the inbound CHANNEL (recalled from the landing page) so it shares a
    // vocabulary with the denominator; cta = which button was pressed. This page's
    // own ?src= is the CTA position, which is why it cannot be the channel.
    // trackG1, not track: see ../track.ts.
    trackG1(CAREGIVER_INTENT, intentProps(window.location.search, recallChannel()));
  }, []);
  return null;
}
