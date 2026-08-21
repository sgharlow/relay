/**
 * One user-facing noun for the person who confirms an emergency.
 *
 * 🔴 THE FIRST-SESSION PATH USED TWO, AND THE SECOND ONE ONLY APPEARED AFTER THE
 * CLICK. The readiness banner's blocker says "No trusted contact yet"; the /rules
 * warning says "Add a trusted contact"; both link to /circle. On /circle the
 * phrase "trusted contact" appeared NOWHERE — the section is headed "Who confirms
 * it is real" and the only button read "Add a verifier".
 *
 * So a new owner is told to add a trusted contact, arrives, and is offered a
 * verifier. Nothing on the destination says the two are the same thing. That is
 * the failure SidebarNav records for the People/Circle split: the owner should
 * not have to "learn an internal distinction" to follow their own to-do list.
 *
 * ⚠️ "verifier" STAYS as the internal word. It is the table, the type, the API
 * and half this codebase, and renaming it would be a contract change for a copy
 * problem. What must not vary is the noun in the SENTENCE THE OWNER READS — so
 * this asserts the button and the blockers that point at it agree, and does not
 * touch the schema.
 *
 * Feature: relay-standby
 * Requirements: CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The circle screen is TWO files since 2026-08-21, and this test is why that
 * matters.
 *
 * J4-R1 folded the two add forms into one `AddPersonForm`, and the phrase "Add a
 * trusted contact" was the label on the verifier form's BUTTON. Moving a form
 * moves the noun with it — so a check pinned to one file would have gone green
 * on a screen where the phrase had vanished, which is the failure this whole
 * file exists to prevent. Both files are read: the form for the words an owner
 * is asked to act on, `PeopleSections` for the heading that explains the job.
 */
const CIRCLE_FORM = 'src/app/(owner)/circle/AddPersonForm.tsx';
const CIRCLE_LIST = 'src/app/(owner)/circle/PeopleSections.tsx';
const READINESS = 'lib/vault/readiness.ts';
const RULES = 'src/app/(owner)/rules/RulesPageClient.tsx';

/** The noun every owner-facing surface uses for this role. */
const NOUN = 'trusted contact';

const markup = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

describe('the destination uses the noun that sent the owner there', () => {
  it('the circle screen offers to add a trusted contact', () => {
    const src = markup(CIRCLE_FORM);
    expect(src, `${CIRCLE_FORM} should use "${NOUN}" where the owner is asked to add one`).toMatch(
      /Add a trusted contact/i,
    );
    expect(src, 'the internal word must not be the label on the control').not.toMatch(
      /Add a verifier/i,
    );
  });

  it('and the list beside it does not reintroduce the internal word', () => {
    // The sections still exist; they list and remove. If one of them ever grows
    // a control again, it must not offer "verifier" as the owner-facing noun.
    expect(markup(CIRCLE_LIST)).not.toMatch(/Add a verifier/i);
  });

  it('the readiness blocker and the rules warning use the same noun', () => {
    // These are the two sentences that send somebody to /circle in the first
    // place. If either drifts, the click lands on a stranger again.
    expect(markup(READINESS)).toMatch(/trusted contact/i);
    expect(markup(RULES)).toMatch(/trusted contact/i);
  });

  it('keeps the plain-language heading, which is what actually explains the job', () => {
    // A noun is a handle, not an explanation. "Who confirms it is real" is the
    // sentence that tells an owner what they are being asked to arrange.
    expect(markup(CIRCLE_LIST)).toMatch(/Who confirms it is real/i);
  });
});
