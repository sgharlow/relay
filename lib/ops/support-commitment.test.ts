/**
 * The acute paths promise a human. This is the promise having a number.
 *
 * THE FINDING (`PROJECT.yaml → deferred → support-has-an-address-and-no-commitment`,
 * C6). `hello@relaystandby.com` is offered on the paths people reach at their
 * worst — `AccessClient` tells a recipient whose reveal failed to write in *"so
 * a person can look"* — and nothing anywhere said how long looking takes. A
 * promise of a human, made to somebody in an emergency, is either kept or it
 * should not be on that screen.
 *
 * RULED 2026-08-20: one business day, stated. Which makes the acute copy true as
 * written, and is why that copy did not have to change.
 *
 * ⚠️ WHAT THIS GUARDS IS THE COUPLING, not the wording. The failure mode is not
 * somebody deleting the sentence — it is somebody adding a SECOND place that
 * states a response time, in different words, and the two drifting until a
 * customer quotes the wrong one back. One definition, consumed everywhere; the
 * same rule `OPERATOR_NAME` follows.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORT_RESPONSE_TIME, CONTACT_EMAIL } from '../contact';

const ABOUT = readFileSync(join(process.cwd(), 'src/app/about/page.tsx'), 'utf8');
const SUPPORT_FORM = readFileSync(join(process.cwd(), 'src/app/help/SupportForm.tsx'), 'utf8');

/** Every .tsx under src/app, so a new surface cannot state its own number. */
function surfaces(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) surfaces(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('the commitment exists and is one value', () => {
  it('is defined in lib/contact, beside the operator and the address', () => {
    expect(SUPPORT_RESPONSE_TIME.trim().length).toBeGreaterThan(0);
  });

  /*
    🔴 THE FIRST VERSION OF THIS ASSERTION WAS BACKWARDS, and it is worth keeping
    the note. It required the page to CONTAIN the literal address — and /about
    correctly imports `CONTACT_EMAIL` and renders `{CONTACT_EMAIL}`, so the
    literal appears nowhere in it. The test would have gone green only on a page
    that hardcoded the address, which is the opposite of the rule this file is
    enforcing one paragraph further down. Assert the reference, not the value.
  */
  it('/about states it, next to the address it qualifies', () => {
    expect(ABOUT).toContain('SUPPORT_RESPONSE_TIME');
    expect(ABOUT).toContain('CONTACT_MAILTO');
  });

  it('the support form states it too — that is where people arrive already stuck', () => {
    expect(SUPPORT_FORM).toContain('SUPPORT_RESPONSE_TIME');
  });

  it('neither page hardcodes the phrase instead of importing it', () => {
    for (const [name, src] of [
      ['about', ABOUT],
      ['SupportForm', SUPPORT_FORM],
    ] as const) {
      const literal = new RegExp(`["'>\\s]${SUPPORT_RESPONSE_TIME}`, 'i');
      const hardcoded = literal.test(src.replace(/SUPPORT_RESPONSE_TIME/g, ''));
      expect(hardcoded, `${name} writes the phrase out instead of importing it`).toBe(false);
    }
  });
});

describe('no surface invents a second answer', () => {
  /*
    The real risk. A page that says "we usually reply within a few hours" beside
    a page that says one business day is two promises, and the customer will
    hold you to whichever is shorter.
  */
  it('no page states a response time of its own', () => {
    const RIVAL = /within (a few|\d+|one|two|three|24|48) (hour|hours|business day|business days|day|days)/i;

    const offenders = surfaces(join(process.cwd(), 'src/app'))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        if (src.includes('SUPPORT_RESPONSE_TIME')) return false;
        return RIVAL.test(src);
      })
      .map((f) => f.replace(process.cwd(), '').replace(/\\/g, '/'));

    expect(
      offenders,
      offenders.length
        ? 'These surfaces state a response time without using the one definition:\n' +
          offenders.map((o) => `  ${o}`).join('\n') +
          '\n\nImport SUPPORT_RESPONSE_TIME from lib/contact instead. Two numbers is two things ' +
          'to keep true, and the one nobody updates is the one a customer quotes back.'
        : 'ok',
    ).toEqual([]);
  });
});

describe('the acute path still routes to a human', () => {
  it('the reveal-failure copy still offers the address', () => {
    // The commitment is what makes this sentence honest. If the sentence goes,
    // the commitment is answering a question nobody is asking any more.
    const access = readFileSync(
      join(process.cwd(), 'src/app/(access)/access/AccessClient.tsx'),
      'utf8',
    );
    expect(access).toContain(CONTACT_EMAIL);
    expect(access).toMatch(/a person can look/i);
  });
});
