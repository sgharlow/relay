/**
 * The shape of a screen that has not arrived yet.
 *
 * 🔴 THERE WAS NO loading.tsx ANYWHERE until 2026-08-13. Every owner route
 * builds dynamic, so navigating held the PREVIOUS screen, frozen and still
 * interactive-looking, until the next one replaced it — no skeleton, no
 * movement, nothing to say the tap had registered. On a fast connection that is
 * invisible. On the phones this product is actually for it is the difference
 * between "loading" and "broken", and the reliable human response to a button
 * that appears to do nothing is to press it again.
 *
 * PROPORTION RATHER THAN A SPINNER. A spinner says "wait"; a skeleton says what
 * is coming, so the page does not appear to jump when it arrives. Each mode
 * gets its own because the two are deliberately different products visually —
 * an owner's dense list and a contact's large-type single column — and a shared
 * grey rectangle would flash the wrong shape in one of them.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

/**
 * ⚠️ ANIMATION IS OPT-OUT, NOT DECORATION. `motion-safe:` means the pulse
 * disappears entirely under prefers-reduced-motion, where a vestibular trigger
 * on a screen somebody is waiting at is exactly the wrong place for one. The
 * layout still communicates without it.
 */
const BAR = 'motion-safe:animate-pulse rounded bg-rule';

export function SkeletonBar({ w, h = 16, mt = 0 }: { w: string; h?: number; mt?: number }) {
  return <div className={BAR} style={{ width: w, height: h, marginTop: mt }} />;
}

/**
 * Announced politely, once, for a reader who cannot see the shapes.
 *
 * `aria-busy` on the region plus a single visually-hidden line — not a live
 * region that fires on every skeleton bar, which is how a screen reader ends up
 * reading a loading state aloud eight times.
 */
export function SkeletonRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
