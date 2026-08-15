/**
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { describeDelivery } from './delivery-claim';

const at = '2026-08-14T10:00:00.000Z';

describe('describeDelivery', () => {
  it('says nothing when nothing has been heard', () => {
    expect(describeDelivery({ name: 'Alex', email: 'alex@gmail.com', verdict: 'unknown', occurredAt: at })).toBeNull();
  });

  /*
    🔴 THE FALSE GREEN THIS FUNCTION EXISTS TO KILL. The screen said "Email
    reached Alex" on an `email.delivered` event — and both Outlook messages in
    the 2026-08-14 test recorded `email.delivered` in Relay's own table while
    sitting in the junk folder at SCL 5. `delivered` and `junked` are the same
    event, so the old sentence told an owner in calm that the channel worked on
    the exact evidence that cannot show it.
  */
  it('never claims a delivered event means the message arrived', () => {
    const line = describeDelivery({ name: 'Alex', email: 'alex@gmail.com', verdict: 'delivered', occurredAt: at });
    expect(line).not.toBeNull();
    expect(line!.text).not.toMatch(/reached|arrived in|is reachable/i);
  });

  it('says what a delivered event actually means', () => {
    const line = describeDelivery({ name: 'Alex', email: 'alex@gmail.com', verdict: 'delivered', occurredAt: at });
    expect(line!.text.toLowerCase()).toContain('accepted');
    expect(line!.text.toLowerCase()).toContain('inbox');
    expect(line!.tone).toBe('note');
  });

  it('is harder about a delivered event to a mailbox we have measured filing us as junk', () => {
    const line = describeDelivery({
      name: 'Alex',
      email: 'alex@outlook.com',
      verdict: 'delivered',
      occurredAt: at,
    });
    expect(line!.text.toLowerCase()).toContain('junk');
    expect(line!.tone).toBe('warn');
  });

  it('keeps the bounce warning, which was never the dishonest one', () => {
    const line = describeDelivery({
      name: 'Alex',
      email: 'alex@gmail.com',
      verdict: 'undeliverable',
      occurredAt: at,
    });
    expect(line!.tone).toBe('warn');
    expect(line!.text.toLowerCase()).toContain('did not arrive');
  });

  it('reports a delay as a delay', () => {
    const line = describeDelivery({
      name: 'Alex',
      email: 'alex@gmail.com',
      verdict: 'delayed',
      occurredAt: at,
    });
    expect(line!.tone).toBe('note');
    expect(line!.text.toLowerCase()).toContain('delayed');
  });

  it('names the person in every sentence it produces', () => {
    for (const verdict of ['delivered', 'undeliverable', 'delayed'] as const) {
      const line = describeDelivery({ name: 'Alex', email: 'alex@gmail.com', verdict, occurredAt: at });
      expect(line!.text, verdict).toContain('Alex');
    }
  });

  it('drops the date rather than printing a broken one', () => {
    const line = describeDelivery({
      name: 'Alex',
      email: 'alex@gmail.com',
      verdict: 'delivered',
      occurredAt: 'not-a-date',
    });
    expect(line!.text).not.toContain('Invalid');
    expect(line!.text).not.toContain('NaN');
  });
});

/*
  READS SOURCE ON PURPOSE. The sentences above can only stay honest if the
  component keeps asking this function for them. A future edit that re-inlines
  the copy would pass every test above while putting the false green back on the
  screen, which is precisely how it got there the first time.
*/
describe('the circle screen delegates its delivery copy here', () => {
  const raw = readFileSync('src/app/(owner)/circle/DeliveryLine.tsx', 'utf8');
  /*
    Comments out, per lib/ops/outbound-mail-bounds.test.ts. The header of that
    component now QUOTES the old sentence in order to explain why it was wrong,
    and a note about a defect must never be mistaken for the defect.
  */
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('imports the shared sentence', () => {
    expect(code).toContain('describeDelivery');
  });

  it('does not carry its own copy of the claim', () => {
    expect(code).not.toMatch(/Email reached/);
  });

  it('hands over the address, without which the provider caveat cannot fire', () => {
    expect(code).toMatch(/email[,\s]/);
  });
});
