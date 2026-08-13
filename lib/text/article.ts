/**
 * "a" or "an" — one definition, because three were not enough.
 *
 * 🔴 THIS DEFECT HAS NOW APPEARED THREE TIMES, in three files, over five days:
 *
 *   2026-08-08  "A emergency trigger was initiated on your account" — in the
 *               SUBJECT LINE of the message that reaches someone during an
 *               actual emergency. Fixed with a private helper in
 *               `lib/notify/notifications.ts`.
 *   2026-08-12  "A emergency release has been started on Margaret Chen's vault"
 *               — on the verifier decision page. Fixed with a SECOND private
 *               helper in `VerifyClient.tsx`, four lines from a comment noting
 *               the first one existed.
 *   2026-08-12  "Everyone you named to confirm a emergency will be asked" — in
 *               the release confirmation, written hours later by the same hand
 *               that had just written the second helper.
 *
 * Two of the five trigger types begin with a vowel, so every template that
 * interpolates one is a place this recurs. Copying the fix each time made the
 * next occurrence certain; the private copies are now gone and this is the only
 * answer, so the fourth site imports rather than reinvents.
 *
 * Why it is worth this much attention for two letters: this product asks a
 * stranger to trust it with a family member's credentials during the worst week
 * of their life. Mail and pages that cannot manage "an" read like a phishing
 * kit, and that impression is expensive in exactly the moment it is fatal.
 *
 * Feature: relay-h0-mvp
 */

/** The indefinite article for a word, by its first letter. */
export function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** Sentence-initial form — "An emergency trigger was initiated". */
export function Article(word: string): 'A' | 'An' {
  return article(word) === 'an' ? 'An' : 'A';
}
