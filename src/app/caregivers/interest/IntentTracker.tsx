'use client';

/**
 * G1 WTP instrument — fires the NUMERATOR event (intent) once on mount when a visitor lands
 * on /caregivers/interest with the price already seen, tagged with `?src=`. Reads
 * window.location.search directly so the page stays statically renderable (no Suspense).
 *
 * Feature: relay-g1-wtp (deploys post-H0-disposition only)
 */

import { useEffect } from 'react';

import {
  CAREGIVER_INTENT,
  intentProps,
  recallChannel,
  firstTimeThisSession,
  INTENT_ONCE_KEY,
} from '../analytics';
import { trackG1 } from '../track';

export default function IntentTracker() {
  useEffect(() => {
    /*
      Once per SESSION, not once per mount. The gate is specified in visitors —
      "N >= 100 qualified visitors" — and this page is the conversion page, so it
      is the one a visitor is likeliest to reload or return to with the back
      button. Every extra mount used to emit the ratified numerator again, which
      biases click-to-intent UP: a false SHIP, which is the error that spends
      money. See firstTimeThisSession in ../analytics.
    */
    if (!firstTimeThisSession(INTENT_ONCE_KEY)) return;
    // src = the inbound CHANNEL (recalled from the landing page) so it shares a
    // vocabulary with the denominator; cta = which button was pressed. This page's
    // own ?src= is the CTA position, which is why it cannot be the channel.
    // trackG1, not track: see ../track.ts.
    trackG1(CAREGIVER_INTENT, intentProps(window.location.search, recallChannel()));
  }, []);
  return null;
}
