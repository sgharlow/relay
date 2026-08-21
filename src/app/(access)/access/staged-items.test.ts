/**
 * A staged item has to SAY when it opens, on the list, from the start.
 *
 * 🔴 THE GUIDE PROMISED IT AND THE SCREEN DID NOT SHOW IT. public/guide/index.html
 * §1.3: "The person it is for sees the item on their list from the start, marked
 * with the date it opens, so they know something is coming rather than concluding
 * the plan is broken." §3.2 says it again. The date was nowhere on the row.
 *
 * The server had always sent it. lib/access/dashboard.ts adds `opens_at` to any
 * item whose delay has not elapsed, with a comment giving the same reason the
 * guide does: "Hiding it would tell the person nothing is coming and invite them
 * to conclude the plan is broken." `AccessClient`'s `AccessItem` interface simply
 * did not declare the field, so it was dropped on arrival and the row rendered as
 * an ordinary one with a Reveal button. The only way to learn the item was held
 * back was to PRESS Reveal and read the denial.
 *
 * ⚠️ FIXED ON THE SCREEN RATHER THAN IN THE GUIDE, and the PDF is the reason.
 * public/guide/relay-guide.pdf is generated and ships beside the HTML; correcting
 * the sentence would have left the PDF making the old promise until somebody
 * regenerated it. Rendering the date makes both true at once — and it was the
 * better behaviour anyway, which is what the guide was describing.
 *
 * Feature: relay-h0-mvp
 * Requirements: R7.2, J8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { opensOnLabel } from './AccessClient';

const ACCESS = 'src/app/(access)/access/AccessClient.tsx';

const code = () =>
  readFileSync(ACCESS, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('opensOnLabel', () => {
  it('names the day in words a family reads, not an ISO string', () => {
    // "2026-09-02T00:00:00.000Z" is a machine's answer to "when does this open".
    expect(opensOnLabel('2026-09-02T00:00:00.000Z')).toMatch(/Opens on \w+ \d+/);
  });

  it('is absent when the item is already open', () => {
    // dashboard.ts omits `opens_at` entirely once the delay has elapsed, so the
    // common case must render nothing rather than an empty badge.
    expect(opensOnLabel(undefined)).toBeNull();
  });

  it('does not crash the plan on an unparseable date', () => {
    /*
      The whole access plan renders from this list. A malformed value — a
      truncated string, a future schema change — must cost the badge, never the
      screen somebody is standing in front of during an emergency.
    */
    expect(opensOnLabel('not-a-date')).toBeNull();
    expect(opensOnLabel('')).toBeNull();
  });
});

describe('the released list renders the date', () => {
  it('declares opens_at on the item it decodes', () => {
    // The field was dropped on arrival because the interface never named it.
    expect(code(), `${ACCESS} must declare opens_at or the server's value is discarded`).toMatch(
      /opens_at\??:\s*string/,
    );
  });

  it('shows it on the row, not only after pressing Reveal', () => {
    /*
      The defect exactly: the date DID surface — as the explainable denial "Not
      open yet — this one was set to open on …" — but only to somebody who
      pressed Reveal on an item they had no reason to think was held back.
    */
    expect(code(), 'the item row should render the opens-on label').toMatch(
      /opensOnLabel\(\s*item\.opens_at\s*\)/,
    );
  });
});
