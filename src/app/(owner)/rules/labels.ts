/**
 * The rules screen, in English rather than in enum values.
 *
 * 🔴 /rules RENDERED THE DATABASE'S VOCABULARY. Its "Trigger type" select showed
 * `emergency / travel / caregiver / business` and its "Scope" select showed
 * `view / act` — on the screen the readiness banner's `no_rules` blocker sends a
 * brand-new owner to, which makes it one of the first things they ever see.
 *
 * The product already had the sentences. `AskControl` offers the same four
 * triggers as "They are away and unreachable" and the like, and the user's guide
 * explains view and act in one line each. `TriggersPageClient` records the same
 * defect being fixed next door: "Every other owner surface says 'Who would step
 * in'; this one alone spoke schema. Found by writing the user manual." /rules was
 * not revisited at the time.
 *
 * ⚠️ OWNER VOICE, NOT RECIPIENT VOICE, and that is why this is not shared with
 * AskControl. The same enum needs two different sentences: the owner is deciding
 * what should happen to THEM ("I am in an emergency"), the standby contact is
 * describing somebody else ("They are away and unreachable"). A single map would
 * have to be keyed by audience, and that belongs in lib/domain beside the enum
 * rather than in a route group. Recorded so the third copy is a decision.
 *
 * ⚠️ TYPED AGAINST THE ENUMS on purpose. `Record<UserSelectableTriggerType, …>`
 * means adding a trigger without a label fails the type check rather than
 * silently rendering its raw value, which is exactly how the raw values got onto
 * the screen in the first place.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2, CC8
 */

import type { Scope, UserSelectableTriggerType } from '../../../../lib/domain/enums';

/** What each trigger means to the owner choosing it. */
export const TRIGGER_LABELS: Record<UserSelectableTriggerType, string> = {
  emergency: 'An emergency',
  caregiver: 'I need care and cannot manage this myself',
  travel: 'I am away and unreachable',
  business: 'Something at work cannot wait',
};

/** What each scope lets the person actually do. The guide's own wording. */
export const SCOPE_LABELS: Record<Scope, string> = {
  view: 'View — they can read it',
  act: 'Act — they can use it: sign in, pay the bill, call the bank',
};
