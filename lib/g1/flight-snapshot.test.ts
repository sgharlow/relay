/**
 * The pre-flight verdict is the half of `flight:snapshot` that can be wrong
 * quietly, so it is tested with planted numbers rather than trusted because a
 * live run came back green. A live run against an empty table passes whether
 * the check works or not.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { windowStarted, preFlightVerdict, formatSnapshotRow } from './flight-snapshot';

describe('reading whether the G1 window has opened', () => {
  it('the real flight log is parsed, not just a fixture', () => {
    // Pinning against the shipped document is the point: a table edit that
    // renames the row would otherwise leave this check reading a fixture that
    // no longer resembles the file.
    const real = readFileSync('docs/g1-flight-log.md', 'utf8');
    expect(real).toMatch(/\|\s*\*\*Window start\*\*\s*\|/);
    // It has not started. If this ever fails, the flight began — fill in the
    // date here in the same edit that fills it in the log.
    expect(windowStarted(real)).toBe(false);
  });

  it('an unfilled placeholder is NOT a started window', () => {
    const md = '| **Window start** | _fill on the day the first ad is APPROVED and serving_ |';
    expect(windowStarted(md)).toBe(false);
  });

  it('a date in the cell IS a started window', () => {
    expect(windowStarted('| **Window start** | 2026-08-28 |')).toBe(true);
  });

  it('a missing row reads as not started — the safe direction', () => {
    // Not started ENFORCES the empty-table pre-flight, so a misread costs a
    // false alarm rather than a silent pass on a contaminated table.
    expect(windowStarted('# a flight log with the table removed')).toBe(false);
  });
});

describe('the sitting sheet pre-flight, as a check rather than a look', () => {
  it('refuses to start a flight on a table that is not empty', () => {
    const v = preFlightVerdict({ windowStarted: false, leads: 1 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/contaminated from day one/);
  });

  it('passes when the table is empty before the window opens', () => {
    expect(preFlightVerdict({ windowStarted: false, leads: 0 }).ok).toBe(true);
  });

  it('never fails once the window is open — arriving demand is the thing being bought', () => {
    // A daily check that went red the moment a lead landed would be turned off
    // in week one, and then it checks nothing for the remaining three.
    const v = preFlightVerdict({ windowStarted: true, leads: 14 });
    expect(v.ok).toBe(true);
    expect(v.reason).toContain('14');
  });
});

describe('the daily row', () => {
  it('carries the lead count and the channels it came from', () => {
    const row = formatSnapshotRow({
      date: '2026-08-29',
      leads: 3,
      qualifiedLeadSrcs: ['reddit-ads'],
    });
    expect(row).toContain('2026-08-29');
    expect(row).toContain('| 3 |');
    expect(row).toContain('reddit-ads');
  });

  it('says so plainly when no lead has arrived yet', () => {
    expect(formatSnapshotRow({ date: '2026-08-29', leads: 0, qualifiedLeadSrcs: [] })).toContain('—');
  });
});
