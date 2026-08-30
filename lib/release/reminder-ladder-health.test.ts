/**
 * Tests for the reminder-ladder dead-man.
 *
 * WHAT IS WORTH PINNING HERE, and it is not "does it detect a missing row" —
 * that is one line. The failures worth designing against are the ones that make
 * a monitor lie:
 *   - alarming on a rung that fell due four minutes ago, which trains a reader
 *     to mute it before the day it is right;
 *   - going green because the ladder's rule said "nothing due" for a reason the
 *     monitor should have reported (the owner is already overdue, the rung is
 *     already recorded) — those are different states with different meanings;
 *   - going green on a question it structurally cannot answer.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, B15.1
 */

import { describe, it, expect } from 'vitest';
import {
  assessLadder,
  REMINDER_GRACE_MS,
  type LadderOwner,
} from './reminder-ladder-health';
import { CHECKIN_REMINDER_RUNGS } from './checkin-reminder';

const NOW = new Date('2026-09-21T18:00:00.000Z');
const MS_PER_DAY = 86_400_000;

/**
 * An owner positioned at a given fraction of a 30-day interval — the product
 * default, and the interval the one live owner actually has.
 */
function ownerAt(fraction: number, rungsSent: string[] = [], intervalDays = 30): LadderOwner {
  const intervalMs = intervalDays * MS_PER_DAY;
  return {
    id: 'o-1',
    checkinIntervalDays: intervalDays,
    lastActiveAt: new Date(NOW.getTime() - fraction * intervalMs).toISOString(),
    rungsSent,
  };
}

const FIRST = CHECKIN_REMINDER_RUNGS[0];
const FINAL = CHECKIN_REMINDER_RUNGS[1];

describe('an unhonoured rung is a finding', () => {
  it('reports a first rung that fell due days ago with nothing recorded', () => {
    const h = assessLadder([ownerAt(0.85)], NOW);
    expect(h.healthy).toBe(false);
    expect(h.unhonoured).toHaveLength(1);
    expect(h.unhonoured[0].rung).toBe(FIRST.key);
    expect(h.unhonoured[0].overdueHours).toBeGreaterThan(REMINDER_GRACE_MS / 3_600_000);
  });

  it('reports the FINAL rung once that one is due and unrecorded', () => {
    const h = assessLadder([ownerAt(0.95, [FIRST.action])], NOW);
    expect(h.healthy).toBe(false);
    expect(h.unhonoured[0].rung).toBe(FINAL.key);
  });

  it('counts the owners it examined, and no more than that about them', () => {
    const h = assessLadder([ownerAt(0.85), ownerAt(0.1)], NOW);
    expect(h.ownersExamined).toBe(2);
    // The shape must never carry an identity out of the process.
    expect(JSON.stringify(h)).not.toContain('o-1');
  });
});

describe('the grace period — the difference between an alarm and noise', () => {
  /*
    A rung that fell due minutes ago has not been missed; the sweep is hourly.
    An alarm here would fire on every owner every cycle and be muted long before
    the cycle it was built for.
  */
  it('says nothing about a rung that has only just fallen due', () => {
    const intervalMs = 30 * MS_PER_DAY;
    const justDue = FIRST.atElapsedFraction + 60_000 / intervalMs;
    expect(assessLadder([ownerAt(justDue)], NOW).healthy).toBe(true);
  });

  it('stays quiet right up to the grace boundary and speaks past it', () => {
    const intervalMs = 30 * MS_PER_DAY;
    const at = (offsetMs: number) =>
      assessLadder([ownerAt(FIRST.atElapsedFraction + offsetMs / intervalMs)], NOW);

    expect(at(REMINDER_GRACE_MS - 60_000).healthy).toBe(true);
    expect(at(REMINDER_GRACE_MS + 60_000).healthy).toBe(false);
  });
});

describe('the states that are NOT findings, and why each one is not', () => {
  it('a rung already recorded is honoured — the ladder did its job', () => {
    expect(assessLadder([ownerAt(0.85, [FIRST.action])], NOW).healthy).toBe(true);
  });

  it('an owner not yet at any rung is not a finding', () => {
    expect(assessLadder([ownerAt(0.2)], NOW).healthy).toBe(true);
  });

  /*
    🔴 THE ONE THAT MATTERS MOST. Past 100% the owner belongs to
    `runHeartbeatSweep`, not to the ladder — `dueRung` returns null there on
    purpose, because a rung at that point would be a second, contradictory
    notice about a release that has already started. This monitor must inherit
    that boundary rather than reporting every overdue owner as an unwarned one,
    which would make it fire loudly and permanently at exactly the moment the
    real alarm is trying to be heard.
  */
  it('an OVERDUE owner is the heartbeat sweep’s, not the ladder’s', () => {
    expect(assessLadder([ownerAt(1.4)], NOW).healthy).toBe(true);
  });

  it('bad data never produces a finding — an unparseable last-active is skipped', () => {
    const broken: LadderOwner = {
      id: 'o-2',
      checkinIntervalDays: 30,
      lastActiveAt: 'not a date',
      rungsSent: [],
    };
    const h = assessLadder([broken], NOW);
    expect(h.healthy).toBe(true);
    expect(h.unhonoured).toEqual([]);
  });

  it('a non-positive interval is skipped rather than divided by', () => {
    const h = assessLadder([ownerAt(0.85, [], 0)], NOW);
    expect(h.healthy).toBe(true);
  });
});

describe('the blind spot is declared, not hidden', () => {
  /*
    At a one-day interval the final rung's window is 2.4h — shorter than the 3h
    grace — so the owner tips past 100% before this check is allowed to speak.
    Returning a bare "healthy" for that would be the monitor's worst failure:
    silence indistinguishable from an answer.
  */
  it('names the rung it cannot report on for a short interval', () => {
    const h = assessLadder([ownerAt(0.5, [], 1)], NOW);
    expect(h.blind.map((b) => b.rung)).toContain(FINAL.key);
    expect(h.blind[0].reason).toMatch(/shorter than/);
  });

  it('has nothing blind at the 30-day default the live owner uses', () => {
    expect(assessLadder([ownerAt(0.5)], NOW).blind).toEqual([]);
  });

  it('a blind spot is not by itself a failure — it is a caveat on the answer', () => {
    const h = assessLadder([ownerAt(0.5, [], 1)], NOW);
    expect(h.blind.length).toBeGreaterThan(0);
    expect(h.healthy).toBe(true);
  });
});

describe('the rule is the ladder’s rule, not a copy of it', () => {
  /*
    If somebody moves a rung, this monitor must move with it. Asserting against
    the imported rungs rather than against 0.75 is what makes that true, and it
    is the reason `dueRung` is called rather than reimplemented.
  */
  it('tracks the rung fractions wherever the ladder puts them', () => {
    const intervalMs = 30 * MS_PER_DAY;
    for (const rung of CHECKIN_REMINDER_RUNGS) {
      const before = rung.atElapsedFraction - 60_000 / intervalMs;
      const after = rung.atElapsedFraction + (REMINDER_GRACE_MS + 60_000) / intervalMs;
      const sentBelow = CHECKIN_REMINDER_RUNGS.filter(
        (r) => r.atElapsedFraction < rung.atElapsedFraction,
      ).map((r) => r.action);

      expect(assessLadder([ownerAt(before, sentBelow)], NOW).healthy).toBe(true);
      expect(assessLadder([ownerAt(after, sentBelow)], NOW).healthy).toBe(false);
    }
  });

  it('reports the HIGHEST due rung, never a backlog of every rung passed', () => {
    const h = assessLadder([ownerAt(0.95)], NOW);
    expect(h.unhonoured).toHaveLength(1);
    expect(h.unhonoured[0].rung).toBe(FINAL.key);
  });
});

describe('the counter that makes the first firing visible', () => {
  /*
    `rungsEverRecorded` is filled in by the database half; the pure assessor
    cannot know it and must not guess a number that would read as "it has
    fired". Zero from the pure function is the honest default.
  */
  it('is zero from the pure assessor, which cannot know', () => {
    expect(assessLadder([ownerAt(0.2)], NOW).rungsEverRecorded).toBe(0);
  });
});
