/**
 * One entry, one person (J4-R1).
 *
 * 🔴 THE DEFECT THIS PINS. /circle carried TWO add forms — one under "Who would
 * step in", one under "Who confirms it is real" — so an owner naming their
 * spouse as both was asked to type the same human twice, and got two rows, two
 * invitations and two claim codes for one person. `lib/people/people.ts` states
 * the model in its first line ("One people list; roles are attributes") and the
 * screen contradicted it at the only point where an owner ever meets the model.
 *
 * Rendered rather than read: a source-level check would pass on a form that
 * exists and returns nothing, which is the exact failure circle-surfaces.test.tsx
 * was written for.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import AddPersonForm, { describeAddOutcome } from './AddPersonForm';
import { RecipientSection, VerifierSection } from './PeopleSections';

const noop = async () => {};

/** Markup with tags stripped, so assertions read against what a human sees. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const formCount = (markup: string) => (markup.match(/<form\b/g) ?? []).length;

describe('AddPersonForm', () => {
  const markup = renderToStaticMarkup(<AddPersonForm onAdded={noop} />);

  it('is one form, and asks for the person once', () => {
    expect(formCount(markup)).toBe(1);
    // One name field and one address field for the whole person — the two-form
    // version asked for both twice.
    expect((markup.match(/type="email"/g) ?? []).length).toBe(1);
  });

  it('offers BOTH hats on that one form', () => {
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const out = text(markup).toLowerCase();
    expect(out).toContain('receive');
    expect(out).toContain('confirm');
  });

  it('says in plain words that one person can hold both', () => {
    // The sentence is the fix. Without it the checkboxes read as a choice
    // between two things rather than as two hats one human can wear.
    expect(text(markup).toLowerCase()).toMatch(/both|one person|same person/);
  });

  it('names no role the Terms disclaim', () => {
    expect(markup).not.toMatch(/>\s*executor\s*</i);
  });
});

describe('the two role sections no longer carry their own add form', () => {
  /*
    THE HALF THAT PROVES THE DEFECT IS GONE RATHER THAN DUPLICATED. Adding a
    unified form while leaving the two behind would give the owner THREE ways in
    and change nothing about the two-rows-for-one-human outcome — it would read
    as fixed and behave exactly as before.
  */
  it('RecipientSection renders no form of its own', () => {
    const out = renderToStaticMarkup(<RecipientSection items={[]} onChange={noop} />);
    expect(formCount(out)).toBe(0);
  });

  it('VerifierSection renders no form of its own', () => {
    const out = renderToStaticMarkup(<VerifierSection items={[]} onChange={noop} />);
    expect(formCount(out)).toBe(0);
  });

  it('still lists people and still says what an empty list means', () => {
    const out = text(renderToStaticMarkup(<RecipientSection items={[]} onChange={noop} />));
    expect(out).toContain('cannot open for anyone');
  });
});

/**
 * The sentence an owner reads after pressing the button.
 *
 * 🔴 THE CASE THAT MATTERS IS THE ONE THAT WROTE NOTHING. Naming somebody who
 * already holds every hat asked for creates no row — and it is a perfectly
 * ordinary thing to do, because an owner forgets they already named their
 * sister. Reporting "Added" over that would be the false-green shape this
 * codebase keeps finding: a screen claiming success because nothing errored.
 *
 * Tested rather than eyeballed, because it is the only place the owner learns
 * whether the two-rows-for-one-human problem just happened to them again.
 */
describe('describeAddOutcome', () => {
  const base = { name: 'Sam', email: 'sam@example.com' };
  const made = (id: string) => ({ id, created: true });
  const had = (id: string) => ({ id, created: false });

  it('says nothing changed when nothing was created', () => {
    const out = describeAddOutcome({
      ...base,
      recipient: had('r-1'),
      verifier: had('v-1'),
      createdAnything: false,
    });
    expect(out).toMatch(/nothing changed/i);
    expect(out, 'must never claim an addition that did not happen').not.toMatch(/\badded\b/i);
  });

  it('names both jobs, and the two codes, when both rows were created', () => {
    const out = describeAddOutcome({
      ...base,
      recipient: made('r-1'),
      verifier: made('v-1'),
      createdAnything: true,
    });
    expect(out).toMatch(/both/i);
    // Claiming binds ONE roster row, so a dual-hat person really does have two
    // things to accept. Saying so is the honest cost of the storage model.
    expect(out, 'the owner has two codes to hand over, and must be told').toMatch(/two codes/i);
  });

  it('says which hat was added when the person was already here', () => {
    const out = describeAddOutcome({
      ...base,
      recipient: had('r-1'),
      verifier: made('v-1'),
      createdAnything: true,
    });
    expect(out).toMatch(/already/i);
    expect(out).toMatch(/confirm an emergency/i);
  });
});
