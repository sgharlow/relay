/**
 * Time-horizon bucket assignment (Requirement 13.3, Property 20) — pg-free so it
 * is reused by the Triage Agent (server) and the recipient access UI (client).
 *
 * Feature: relay-h0-mvp
 * Requirements: 13.3
 */

export type Bucket = 'do_today' | 'this_week' | 'within_30_days';

export const BUCKET_LABELS: Record<Bucket, string> = {
  do_today: 'Do today',
  this_week: 'This week',
  within_30_days: 'Within 30 days',
};

export const BUCKET_ORDER: Bucket[] = ['do_today', 'this_week', 'within_30_days'];

/** Root credentials → do_today; ≥0.7 → do_today; 0.4–0.699 → this_week; else within_30_days. */
export function bucketFor(item: { importance_score: number; is_root_credential: boolean }): Bucket {
  if (item.is_root_credential || item.importance_score >= 0.7) return 'do_today';
  if (item.importance_score >= 0.4) return 'this_week';
  return 'within_30_days';
}
