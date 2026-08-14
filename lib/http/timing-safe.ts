/**
 * Constant-time string comparison for shared secrets.
 *
 * `a !== b` on a secret leaks, in principle, how many leading characters were
 * right — JS string comparison stops at the first difference. Over a network,
 * against a 64-character hex secret, this is not a practical attack and nobody
 * should pretend otherwise. It is here because the alternative costs one line
 * and removes the question entirely, and because a reader auditing this file
 * should not have to reason about whether it matters.
 *
 * LENGTH IS NOT SECRET AND IS COMPARED FIRST. `crypto.timingSafeEqual` throws
 * on differing lengths, so a naive wrapper would turn a length mismatch into a
 * 500 — and the length of "Bearer <secret>" is not the part worth protecting.
 *
 * Feature: relay-h0-mvp
 */

import { timingSafeEqual } from 'node:crypto';

export function timingSafeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
