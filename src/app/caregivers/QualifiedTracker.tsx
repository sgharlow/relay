'use client';

/**
 * G1 WTP instrument — fires the DENOMINATOR event (a qualified /caregivers visit) once on
 * mount, tagged with the inbound `?src=` channel. Reads window.location.search directly (not
 * useSearchParams) so the landing stays statically renderable — no Suspense boundary, no
 * forced dynamic rendering. Analytics is client-only, so the effect is the right seam.
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import { track } from '@vercel/analytics';
import { useEffect } from 'react';

import { CAREGIVER_QUALIFIED, srcFromSearch } from './analytics';

export default function QualifiedTracker() {
  useEffect(() => {
    track(CAREGIVER_QUALIFIED, srcFromSearch(window.location.search));
  }, []);
  return null;
}
