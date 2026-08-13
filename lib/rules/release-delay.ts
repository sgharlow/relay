/**
 * "Release after N days" — the staged half of an access rule.
 *
 * 🔴 THIS CONTROL DID NOTHING AT ALL until 2026-08-13. `release_after_days` was
 * offered on /rules ("Release after ___ days"), validated as a non-negative
 * integer, persisted, read back into the form, and documented in the user manual
 * as "holds a rule back — useful when you want the urgent things open
 * immediately and the rest only if you are still unreachable a week later".
 *
 * No code anywhere consulted it when deciding access. Both gates —
 * `lib/kms/unwrap-gate.ts` and `lib/access/dashboard.ts` — asked only whether a
 * matching `access_rules` row existed and whether the release was `released`. So
 * an owner who deliberately staged their most sensitive items behind a week got
 * exactly the same behaviour as one who staged nothing: everything opened at
 * once, in the first minute.
 *
 * That is worse than an absent feature. An absent one is visible; this one
 * accepted the instruction, showed it back, and quietly discarded it — so the
 * owner's belief about their own plan was wrong in the direction that exposes
 * more than they intended, and nothing they could see would have told them.
 *
 * ONE DEFINITION, because there are two gates. A "check the delay" convention
 * applied at each call site is precisely the shape that produced the bug: a rule
 * every consumer must remember is a rule that will be forgotten at the next
 * call site added. Both gates call this, and the test asserts they both do.
 *
 * Feature: relay-h0-mvp
 * Requirements: 6.4
 */

const MS_PER_DAY = 86_400_000;

/**
 * Is a staged rule open yet?
 *
 * FAILS CLOSED on missing data. A rule that asks for a delay, on a release with
 * no `released_at`, is held rather than opened: the only way to reach that state
 * is a row written outside the normal transitions, and guessing "probably fine"
 * about an item its owner asked to hold back is the wrong guess to make.
 *
 * @param releaseAfterDays `null`/`0` means no delay — open as soon as released.
 * @param releasedAt when the release actually entered `released`.
 */
export function isDelayElapsed(
  releaseAfterDays: number | null | undefined,
  releasedAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (releaseAfterDays == null || releaseAfterDays <= 0) return true;
  if (releasedAt == null) return false;

  const started = releasedAt instanceof Date ? releasedAt : new Date(releasedAt);
  const startedMs = started.getTime();
  if (!Number.isFinite(startedMs)) return false;

  return now.getTime() >= startedMs + releaseAfterDays * MS_PER_DAY;
}

/**
 * When a staged rule opens, for telling somebody rather than for gating.
 * `null` when there is nothing to wait for.
 */
export function opensAt(
  releaseAfterDays: number | null | undefined,
  releasedAt: string | Date | null | undefined,
): Date | null {
  if (releaseAfterDays == null || releaseAfterDays <= 0) return null;
  if (releasedAt == null) return null;

  const started = releasedAt instanceof Date ? releasedAt : new Date(releasedAt);
  if (!Number.isFinite(started.getTime())) return null;

  return new Date(started.getTime() + releaseAfterDays * MS_PER_DAY);
}
