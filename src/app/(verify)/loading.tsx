/**
 * The verifier's screen, waiting.
 *
 * One question and three answers is all this mode ever renders, so the skeleton
 * is that shape: a heading, a little context, and three equal blocks. Equal on
 * purpose — the decision surface presents deny, abstain and confirm at the same
 * prominence, and a skeleton that made one look bigger would be pre-loading a
 * suggestion.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { SkeletonBar, SkeletonRegion } from '../_components/Skeleton';

export default function Loading() {
  return (
    <SkeletonRegion label="Loading the request">
      <SkeletonBar w="76%" h={30} />
      <SkeletonBar w="94%" h={18} mt={16} />
      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonBar key={i} w="100%" h={56} />
        ))}
      </div>
    </SkeletonRegion>
  );
}
