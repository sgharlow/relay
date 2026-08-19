/**
 * Recording what an ACCOUNT demands at the door.
 *
 * One definition, because there are now two places an owner can answer the
 * question: the control on the vault row, and the prompt in the readiness
 * banner that finally ASKS it rather than waiting to be found. Two hand-written
 * fetches to the same endpoint would drift, and the values here are ones where
 * drift is silent — see the test on `[]` versus `null`.
 *
 * ⚠️ THREE STATES, AND `null` IS NOT A NEUTRAL DEFAULT.
 *   `['totp']` — the owner says the account asks for a code as well.
 *   `[]`       — the owner says a password is enough. An ANSWER; makes the item usable.
 *   `null`     — nobody has said. Withdraws the answer and returns the item to unasked.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

/** The factors an owner can currently be asked about — see the one-factor note in `usability.ts`. */
export type DeclarableFactor = 'totp';

/**
 * The one announcement, so the two surfaces cannot disagree.
 *
 * 🔴 THE DEFECT. The answer is recorded in two places and READ in two places,
 * and the readers are siblings that never speak: `ReadinessBanner` lives in
 * `(owner)/layout.tsx` with its own `/api/readiness` fetch, and
 * `VaultDashboardClient` is the page with its own `/api/vault/items` fetch.
 * Each refreshes itself after a save and neither tells the other, so answering
 * in either place left the OTHER showing the old state until a page reload.
 *
 * ⚠️ IT WAS RECORDED AS ONE DIRECTION AND IS ACTUALLY TWO. `PROJECT.yaml`
 * noted only "the vault row still reads `Needs a code?` until the page is
 * reloaded" after a banner answer, and called it cosmetic on the grounds that
 * "the sentence is authoritative and correct". The component boundary breaks
 * symmetrically: answering on the ROW leaves the BANNER stale, which makes the
 * authoritative sentence the wrong one — a preparedness claim that has already
 * been superseded by the owner's own answer, still on screen. That is the half
 * worth fixing, and it is not cosmetic.
 *
 * WHY HERE. This module already exists because "two hand-written fetches to the
 * same endpoint would drift" — it is the single seam every write goes through,
 * and `lib/ops/the-question-is-asked.test.ts` enforces that. Announcing from
 * the seam rather than from each caller means a THIRD place to answer, added
 * later, refreshes both surfaces without its author knowing they exist. Safety
 * by architecture rather than by remembering.
 *
 * An EventTarget owned by this module rather than React context or a store:
 * the two components are in different trees (layout and page) with no common
 * provider, and adding one would be a larger change than the defect warrants.
 * They share this bus because they import this module, which the client bundle
 * instantiates once — the same reason a provider-less store works at all.
 *
 * ⚠️ NOT `window`, and the reason is testability rather than taste. Vitest runs
 * this repo with `environment: 'node'` and there is no jsdom or happy-dom
 * dependency, so a `window`-based bus can only be written with a
 * `typeof window === 'undefined'` guard — and under that guard every test of it
 * passes by taking the branch that does nothing. That is the "guard on the
 * wrong gate" shape this codebase keeps finding. `EventTarget` is a global in
 * both Node and the browser, so the bus under test is the bus that ships.
 */
export const FACTORS_DECLARED_EVENT = 'relay:factors-declared';

const bus = new EventTarget();

/** Subscribe to declarations. Returns the unsubscribe, for `useEffect` cleanup. */
export function onFactorsDeclared(handler: () => void): () => void {
  bus.addEventListener(FACTORS_DECLARED_EVENT, handler);
  return () => bus.removeEventListener(FACTORS_DECLARED_EVENT, handler);
}

export async function setFactorsRequired(
  itemId: string,
  value: DeclarableFactor[] | null,
): Promise<void> {
  const res = await fetch(`/api/vault/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ factors_required: value }),
  });
  if (!res.ok) throw new Error('Could not save that.');

  /*
    AFTER the throw, never before: announcing a save that failed would refresh
    both surfaces into showing the same unchanged state and read as success.

    The component that just saved will usually reload twice — once from its own
    `await load()`, once from this. That is deliberate. The explicit reload is
    what keeps its spinner up until the screen actually agrees, and suppressing
    the duplicate would need callers to identify themselves, which is exactly
    the per-caller knowledge this seam exists to remove. One extra GET on a
    deliberate click is the cheaper trade.
  */
  bus.dispatchEvent(new Event(FACTORS_DECLARED_EVENT));
}
