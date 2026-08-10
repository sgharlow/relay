'use client';

/**
 * G1 WTP instrument — fires the DENOMINATOR event (a qualified /caregivers visit) once on
 * mount, tagged with the inbound `?src=` channel. Reads window.location.search directly (not
 * useSearchParams) so the landing stays statically renderable — no Suspense boundary, no
 * forced dynamic rendering. Analytics is client-only, so the effect is the right seam.
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import { useEffect } from 'react';

import { CAREGIVER_QUALIFIED, rememberChannel, srcFromSearch } from './analytics';
import { clickIdFrom, rememberClickId } from './click-id';
import { trackG1 } from './track';

export default function QualifiedTracker() {
  useEffect(() => {
    const props = srcFromSearch(window.location.search);
    // Park the inbound channel so the intent event on the next page can report it —
    // its own ?src= is the CTA position, not the channel. See analytics.ts.
    rememberChannel(props.src);
    // The click ID exists on this URL and nowhere after it. Parked alongside
    // the channel so it survives the walk to the conversion page.
    rememberClickId(clickIdFrom(window.location.search));
    // trackG1, not track: this effect runs before <Analytics/> creates the queue,
    // so a bare track() call is silently dropped. See track.ts.
    trackG1(CAREGIVER_QUALIFIED, props);
  }, []);
  return null;
}
