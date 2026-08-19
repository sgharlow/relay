/**
 * Reading a column in a way that cannot mistake a missing wire for a missing
 * answer.
 *
 * 🔴 THE DEFECT CLASS THIS CLOSES, from 2026-08-18. `assessReadiness` selected
 * four columns from `vault_items` and the rule it fed read seven. The three it
 * never selected arrived as `undefined`, `?? null` turned them into `null`, and
 * `null` is a MEANINGFUL DOMAIN VALUE here — it means "no client has ever
 * declared" — so the product rendered a forgotten column as a sentence about
 * the owner: *"nobody has checked whether 2 of them need a code as well"*. That
 * is a claim about Margaret produced by a bug in a query.
 *
 * The two causes are distinguishable, and cheaply, because `pg` returns exactly
 * the columns the query asked for:
 *
 *   key ABSENT  → the projection did not include it. A fact about the CODE.
 *   value null  → the column is SQL NULL. A fact about the DATA.
 *
 * `row.x ?? null` erases that distinction at the exact moment it is created.
 * This preserves it, and fails loudly on the half that is a bug — which is the
 * house rule everywhere else in this repo: let it fail rather than guard it
 * into silence.
 *
 * ⚠️ USE IT WHERE ABSENCE CARRIES MEANING — a column whose `null` the product
 * reports on or decides with (`secret_kinds`, `factors_required`, the owner's
 * overrides). A column whose absence merely selects a default does not need it,
 * and wrapping everything would bury the signal in ceremony.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

/**
 * Reads a column that must have been selected.
 *
 * @throws if the key is absent from the row — i.e. the query did not ask for it.
 */
export function selected<T>(row: Record<string, unknown>, key: string): T | null {
  const value = row[key];
  if (!(key in row) || value === undefined) {
    throw new Error(
      `${key} was not selected, so this read cannot answer questions about it. ` +
        'Add it to the projection. (An absent column and a NULL column are different facts: ' +
        'the first is a bug in the query, the second is an answer from the data, and code that ' +
        'treats them alike reports the bug as a statement about the user.)',
    );
  }
  return (value as T | null) ?? null;
}
