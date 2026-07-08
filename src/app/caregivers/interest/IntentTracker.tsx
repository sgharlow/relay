'use client';

/**
 * G1 WTP instrument — fires the NUMERATOR event (intent) once on mount when a visitor lands
 * on /caregivers/interest with the price already seen, tagged with `?src=`. Reads
 * window.location.search directly so the page stays statically renderable (no Suspense).
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import { track } from '@vercel/analytics';
import { useEffect } from 'react';

import { CAREGIVER_INTENT, srcFromSearch } from '../analytics';

export default function IntentTracker() {
  useEffect(() => {
    track(CAREGIVER_INTENT, srcFromSearch(window.location.search));
  }, []);
  return null;
}
