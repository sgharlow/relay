/**
 * Owner mode, waiting.
 *
 * The sidebar is rendered by the layout and stays put, so this fills only the
 * main column — a heading, a line of context, and a few rows. Dense and
 * neutral, matching the mode it belongs to.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { SkeletonBar, SkeletonRegion } from '../_components/Skeleton';

export default function Loading() {
  return (
    <SkeletonRegion label="Loading your vault">
      <SkeletonBar w="42%" h={28} />
      <SkeletonBar w="64%" h={14} mt={12} />
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[92, 78, 85, 70, 88].map((w, i) => (
          <SkeletonBar key={i} w={`${w}%`} h={44} />
        ))}
      </div>
    </SkeletonRegion>
  );
}
