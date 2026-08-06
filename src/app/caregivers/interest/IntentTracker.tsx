'use client';

/**
 * G1 WTP instrument — fires the NUMERATOR event (intent) once on mount when a visitor lands
 * on /caregivers/interest with the price already seen, tagged with `?src=`. Reads
 * window.location.search directly so the page stays statically renderable (no Suspense).
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import { useEffect } from 'react';

import { CAREGIVER_INTENT, srcFromSearch } from '../analytics';
import { trackG1 } from '../track';

export default function IntentTracker() {
  useEffect(() => {
    // trackG1, not track: this effect runs before <Analytics/> creates the queue,
    // so a bare track() call is silently dropped. See ../track.ts.
    trackG1(CAREGIVER_INTENT, srcFromSearch(window.location.search));
  }, []);
  return null;
}
