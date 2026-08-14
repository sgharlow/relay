/**
 * Access mode, waiting.
 *
 * Fewer, larger blocks than owner mode, because the screens here are
 * single-column and set in 18–20px — and because the person reading this one is
 * frequently mid-emergency on a phone. The label says something true and calm
 * rather than "Loading…": a blank pause during an emergency is the moment
 * somebody decides the product has failed them.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { SkeletonBar, SkeletonRegion } from '../_components/Skeleton';

export default function Loading() {
  return (
    <SkeletonRegion label="Getting this ready. Nothing has gone wrong.">
      <SkeletonBar w="70%" h={32} />
      <SkeletonBar w="90%" h={18} mt={16} />
      <SkeletonBar w="82%" h={18} mt={8} />
      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[100, 100, 88].map((w, i) => (
          <SkeletonBar key={i} w={`${w}%`} h={64} />
        ))}
      </div>
    </SkeletonRegion>
  );
}
