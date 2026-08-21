/**
 * The rules screen spoke schema, on the step a new owner is sent to first.
 *
 * 🔴 THE READINESS BANNER'S `no_rules` BLOCKER POINTS HERE, and what a new owner
 * found was a form made of enum values: a "Trigger type" select rendering
 * `emergency / travel / caregiver / business`, a "Scope" select rendering
 * `view / act`, a bare "Release after [ ] days" box with no explanation, and the
 * heading "Grant a recipient scoped access to an item under a trigger."
 *
 * The product already knows how to say all of this in English. AskControl offers
 * "They are away and unreachable" for the same enum, and the user's guide
 * explains view/act and release-after in two sentences each. This screen alone
 * showed the database's vocabulary.
 *
 * TriggersPageClient records the identical defect being fixed on the neighbouring
 * screen: "Every other owner surface says 'Who would step in'; this one alone
 * spoke schema. Found by writing the user manual." /rules was not revisited.
 *
 * 🔴 AND ITS EMPTY STATE WAS A DEAD END. With no items or no recipients, the two
 * selects render "Select an item…" over nothing at all, the list says "No rules
 * yet.", and nothing on the page says an owner must add an item or name somebody
 * FIRST — on the screen the banner sent them to in order to become ready.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2, CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { USER_SELECTABLE_TRIGGER_TYPES, VALID_SCOPES } from '../../../../lib/domain/enums';
import { TRIGGER_LABELS, SCOPE_LABELS } from './labels';

const SCREEN = 'src/app/(owner)/rules/RulesPageClient.tsx';

const markup = () =>
  readFileSync(SCREEN, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

describe('the labels cover the enums they stand for', () => {
  it('has a plain-language label for every selectable trigger', () => {
    /*
      Keyed off the enum, not a copy of it. A trigger added to
      USER_SELECTABLE_TRIGGER_TYPES with no label would otherwise fall back to
      rendering its raw value — which is the defect, reintroduced quietly.
    */
    for (const t of USER_SELECTABLE_TRIGGER_TYPES) {
      expect(TRIGGER_LABELS[t], `no plain label for trigger "${t}"`).toBeTruthy();
      expect(TRIGGER_LABELS[t]).not.toBe(t);
    }
  });

  it('has a plain-language label for every scope', () => {
    for (const s of VALID_SCOPES) {
      expect(SCOPE_LABELS[s], `no plain label for scope "${s}"`).toBeTruthy();
      expect(SCOPE_LABELS[s]).not.toBe(s);
    }
  });

  it('explains what view and act actually mean, in the guide’s words', () => {
    // The guide: "View means read it. Act means use it — sign in, pay the bill,
    // call the bank." A one-word label still leaves the owner guessing.
    expect(SCOPE_LABELS.view).toMatch(/read/i);
    expect(SCOPE_LABELS.act).toMatch(/use|sign in|pay/i);
  });
});

describe('the screen renders the labels rather than the values', () => {
  it('does not map the trigger enum straight into option text', () => {
    const src = markup();
    expect(src, 'the trigger select should render TRIGGER_LABELS').toMatch(/TRIGGER_LABELS\[/);
    expect(src, 'the scope select should render SCOPE_LABELS').toMatch(/SCOPE_LABELS\[/);
  });

  it('explains the release-after delay instead of leaving a bare number box', () => {
    expect(markup(), '"Release after [ ] days" means nothing on its own').toMatch(
      /only open if you are still unreachable|holds this rule back|wait, and only open/i,
    );
  });

  it('does not describe itself in schema terms', () => {
    expect(markup(), 'the header spoke the data model').not.toMatch(
      /Grant a recipient scoped access to an item under a trigger/i,
    );
  });
});

describe('the empty state names the prerequisite', () => {
  it('tells an owner with no items what to do, and links there', () => {
    const src = markup();
    expect(src, 'the screen must notice it has nothing to build a rule from').toMatch(
      /items\.length === 0/,
    );
    expect(src, 'and point at where items are added').toMatch(/href="\/vault/);
  });

  it('tells an owner with no recipients where people are named', () => {
    const src = markup();
    expect(src).toMatch(/recipients\.length === 0/);
    expect(src).toMatch(/href="\/circle"/);
  });
});
