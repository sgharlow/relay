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

import { windowStarted, preFlightVerdict, formatSnapshotRow, snapshotDate } from './flight-snapshot';

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

describe('snapshotDate — the daily row is stamped in the local day of the sitting', () => {
  /*
    🔴 REGRESSION FOUND 2026-08-18 BY RUNNING THE COMMAND, not by reading it.
    `npm run flight:snapshot` at 18:07 local (UTC-07:00) printed a row dated
    2026-08-19. The script used `new Date().toISOString().slice(0,10)` — UTC —
    and the sitting sheet schedules the sitting in the EVENING, so the normal
    path filed every row a day ahead on the log of record for the gate.
  */
  it('uses the local calendar day, not UTC', () => {
    // 2026-08-18 18:07 at UTC-07:00 == 2026-08-19 01:07 UTC. The old code said
    // the 19th; the sitting happened on the 18th.
    const eveningSitting = new Date(2026, 7, 18, 18, 7, 0);
    expect(snapshotDate(eveningSitting)).toBe('2026-08-18');
    expect(snapshotDate(eveningSitting)).not.toBe(
      eveningSitting.toISOString().slice(0, 10),
    );
  });

  it('pads month and day so the rows sort as text', () => {
    expect(snapshotDate(new Date(2026, 0, 5, 9, 0, 0))).toBe('2026-01-05');
    expect(snapshotDate(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31');
  });

  it('a midnight sitting still belongs to the day it happened on', () => {
    expect(snapshotDate(new Date(2026, 7, 18, 0, 0, 0))).toBe('2026-08-18');
    expect(snapshotDate(new Date(2026, 7, 18, 23, 59, 59))).toBe('2026-08-18');
  });
});
