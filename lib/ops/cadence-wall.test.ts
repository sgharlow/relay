/**
 * Every rule in the cadence wall, proven against a planted violation, plus the
 * live numbers that set the floor.
 *
 * Feature: relay-h0-mvp
 * Requirements: B11, B12.i
 */

import { describe, it, expect } from 'vitest';

import { WATCHED, floorFor, judge, judgeAll, explain } from './cadence-wall';

/*
  Measured 2026-08-29 over 2026-08-24..29. THREE populations, not two — 08-26 is
  the day the collapse began and sits between them. Splitting it out is what lets
  the floor be justified instead of asserted.
*/
const CANARY_HEALTHY = [36, 38];
const CANARY_TRANSITIONAL = 24; // 2026-08-26 — lands exactly on the floor
const CANARY_COLLAPSED = [2, 3, 4];
const SCHEDULER_HEALTHY = [25, 26];
const SCHEDULER_TRANSITIONAL = 17;
const SCHEDULER_COLLAPSED = [3, 2, 4];

const canary = WATCHED.find((w) => w.file === 'production-canary.yml')!;
const scheduler = WATCHED.find((w) => w.file === 'scheduler-monitor.yml')!;

describe('the floor sits in the gap between the two measured populations', () => {
  /*
    The whole credibility of this alarm is that its threshold was derived from
    data rather than chosen. If a future edit moves the floor, these fail and
    ask for the new measurement.
  */
  it('every healthy day measured on 2026-08-24..26 is ABOVE the floor', () => {
    for (const n of CANARY_HEALTHY) expect(judge(canary, n), `canary ${n}`).toBeNull();
    for (const n of SCHEDULER_HEALTHY) expect(judge(scheduler, n), `scheduler ${n}`).toBeNull();
  });

  it('every collapsed day measured on 2026-08-27..29 is BELOW the floor', () => {
    for (const n of CANARY_COLLAPSED) expect(judge(canary, n), `canary ${n}`).not.toBeNull();
    for (const n of SCHEDULER_COLLAPSED) expect(judge(scheduler, n), `scheduler ${n}`).not.toBeNull();
  });

  /*
    A floor near nominal would have fired on every day this repo has ever
    recorded — the best high-frequency day on file is 57% of nominal. An alarm
    that has never been green is an alarm that gets deleted.
  */
  it('is not set so high that a good day would fail', () => {
    expect(floorFor(canary)).toBeLessThan(Math.min(...CANARY_HEALTHY));
    expect(floorFor(scheduler)).toBeLessThan(Math.min(...SCHEDULER_HEALTHY));
  });

  /*
    The uncomfortable half, pinned so nobody "fixes" it later without meeting the
    trade-off: the alarm does NOT fire on the day the collapse began. 2026-08-26
    lands exactly on the canary's floor and passes. A floor set to catch it would
    sit inside the healthy population and fire on ordinary days, which is the
    failure that gets an alarm muted.
  */
  it('does NOT fire on the transitional day — stated, not hidden', () => {
    expect(CANARY_TRANSITIONAL).toBe(floorFor(canary));
    expect(judge(canary, CANARY_TRANSITIONAL)).toBeNull();
    expect(judge(scheduler, SCHEDULER_TRANSITIONAL)).toBeNull();
  });

  it('encodes an "at least hourly" contract for the canary', () => {
    // 24 runs/day is a one-hour detection window: degraded, but still a monitor.
    expect(floorFor(canary)).toBe(24);
    expect(24 / floorFor(canary)).toBe(1);
  });

  it('is not set so low that a collapsed day would pass', () => {
    expect(floorFor(canary)).toBeGreaterThan(Math.max(...CANARY_COLLAPSED));
    expect(floorFor(scheduler)).toBeGreaterThan(Math.max(...SCHEDULER_COLLAPSED));
  });
});

describe('zero is its own finding', () => {
  it('says NOT RUNNING AT ALL rather than quoting a rate', () => {
    const f = judge(canary, 0)!;
    expect(f.detail).toMatch(/NOT RUNNING AT ALL/);
    expect(f.detail).not.toMatch(/detection window/);
  });

  /*
    The 60-day public-repo auto-disable is the likeliest cause of a true zero and
    is the one an operator would not think of, so the message names it.
  */
  it('names the 60-day public-repo auto-disable, which is the likeliest cause of a true zero', () => {
    expect(judge(canary, 0)!.detail).toMatch(/60 days/);
  });

  it('a non-zero shortfall quotes the real detection window instead', () => {
    const f = judge(canary, 4)!;
    expect(f.detail).toMatch(/6\.0 hours/);
    expect(f.detail).toMatch(/designed 96|against a designed 96/);
  });
});

describe('judgeAll', () => {
  it('is silent when both are healthy', () => {
    expect(judgeAll({ 'production-canary.yml': 40, 'scheduler-monitor.yml': 20 })).toEqual([]);
  });

  it('reports the collapse measured on 2026-08-29', () => {
    const f = judgeAll({ 'production-canary.yml': 4, 'scheduler-monitor.yml': 4 });
    expect(f.map((x) => x.file)).toEqual(['production-canary.yml', 'scheduler-monitor.yml']);
  });

  /*
    A workflow missing from the counts map means the API returned nothing for it,
    which is indistinguishable from it not running — and must NOT be read as
    healthy. Defaulting an absent key to 0 is the fail-closed choice.
  */
  it('treats a missing count as zero, not as healthy', () => {
    const f = judgeAll({ 'production-canary.yml': 40 });
    expect(f).toHaveLength(1);
    expect(f[0].file).toBe('scheduler-monitor.yml');
    expect(f[0].observed).toBe(0);
  });
});

describe('the message', () => {
  it('points at the register, so a known defect is not investigated from scratch', () => {
    const msg = explain(judgeAll({ 'production-canary.yml': 4, 'scheduler-monitor.yml': 4 }));
    expect(msg).toMatch(/KNOWN OPEN defect/);
    expect(msg).toMatch(/the-scheduled-monitors-are-collapsing/);
    expect(msg).toMatch(/the-alarms-live-inside-the-thing-they-watch/);
  });

  it('says what would actually be new', () => {
    const msg = explain(judgeAll({ 'production-canary.yml': 4 }));
    expect(msg).toMatch(/what would be new/i);
  });

  it('states the consequence in operational terms, not as a metric', () => {
    const msg = explain(judgeAll({ 'production-canary.yml': 4 }));
    expect(msg).toMatch(/no effective synthetic monitoring/);
  });

  it('is quiet when there is nothing to say', () => {
    expect(explain([])).toMatch(/above its floor/);
  });
});
