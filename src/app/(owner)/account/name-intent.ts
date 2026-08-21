/**
 * What pressing "Save name" should do, given what is in the box.
 *
 * Factored out of AccountClient so the decision can be tested without a browser,
 * a session or a fetch — the repo's standing convention, and the part that
 * actually matters here is not the rendering but whether an empty box is allowed
 * to delete something silently. It was.
 *
 * Feature: relay-h0-mvp
 */

export type NameSaveIntent =
  /** Send the typed name. */
  | 'save'
  /** Empty box, not yet confirmed — ask before destroying anything. */
  | 'confirm-clear'
  /** Empty box, confirmed — send the clear. */
  | 'clear';

export function nameSaveIntent(name: string, confirmed: boolean): NameSaveIntent {
  // Trimmed, because "   " reaches the API as an empty display name anyway and
  // must not take the quiet path that a visible name takes.
  if (name.trim() !== '') return 'save';
  return confirmed ? 'clear' : 'confirm-clear';
}
