/**
 * The dead-man for the check-in reminder ladder.
 *
 * This handler executed no test until 2026-08-30 — and it is the newest probe in
 * the estate, added on the day the ladder was found never to have fired for
 * anybody.
 *
 * 🔴 THIS IS THE PROBE THAT ANSWERS A DIFFERENT QUESTION FROM ITS SIBLING, and
 * the whole reason it exists separately. `/api/health/scheduler` says the cron
 * ticked. This says the owner was actually WARNED. They come apart in exactly
 * the case that matters: `sweepCheckinReminders` never throws, so a reminder
 * sweep that silently sends nothing leaves the scheduler probe green and an
 * owner unwarned right up to the day their vault starts opening. A change that
 * merged the two would mean one alarm for two questions, and the quieter
 * question losing.
 *
 * 🔴 IT MUST NOT NAME THE PERSON WHO WAS NOT WARNED. Public and unauthenticated
 * on the same terms as its siblings, so it may expose counts, rung names and
 * ages — never an email, never an owner id. `ownersExamined` is a number for
 * precisely this reason.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, CC9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/release/reminder-ladder-health', () => ({
  getReminderLadderHealth: vi.fn(),
}));

import { getReminderLadderHealth } from '../../../../../lib/release/reminder-ladder-health';
import { GET } from './route';

const mockHealth = vi.mocked(getReminderLadderHealth);

const HEALTHY = { healthy: true, ownersExamined: 1, overdueRungs: 0, graceHours: 3 };
const UNWARNED = {
  healthy: false,
  ownersExamined: 1,
  overdueRungs: 1,
  graceHours: 3,
  worstRung: 'first',
  worstAgeHours: 9,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHealth.mockResolvedValue(HEALTHY as never);
});

describe('the code a monitor reads', () => {
  it('answers 200 while no rung is overdue and unrecorded', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(HEALTHY);
  });

  it('answers 503 when a rung fell due and nothing was sent', async () => {
    // The ladder's failure mode is silence by design. This 503 is the only
    // noise it will ever make.
    mockHealth.mockResolvedValueOnce(UNWARNED as never);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(UNWARNED);
  });

  it('leaves the healthy/unhealthy decision in the library', async () => {
    mockHealth.mockResolvedValueOnce({ healthy: false } as never);
    expect((await GET()).status).toBe(503);
  });
});

describe('what an unauthenticated caller may see', () => {
  it('names no owner, even in the unhealthy case', async () => {
    mockHealth.mockResolvedValueOnce(UNWARNED as never);
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/@/);
    expect(body).not.toMatch(/owner_id|ownerId|email/i);
    // A count is the most it may say about who was missed.
    expect(JSON.parse(body).ownersExamined).toBe(1);
  });
});
