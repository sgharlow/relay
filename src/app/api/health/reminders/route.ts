/**
 * GET /api/health/reminders — the dead-man for the check-in reminder ladder.
 *
 * Returns 503 when an owner has had a reminder rung due for longer than the
 * grace period with nothing in the audit log to show for it. The ladder's own
 * failure mode is silence — `sweepCheckinReminders` never throws — so the only
 * way to notice is to ask about the ABSENCE of its side effect.
 *
 * ⚠️ WHY IT IS A SEPARATE PROBE FROM `/api/health/scheduler`, which already
 * exists and is already watched. That one answers "is the cron ticking". This
 * one answers "was the owner actually warned", and the two come apart in the
 * case that matters: a healthy cron whose reminder sweep silently sends nothing
 * leaves the scheduler probe green and an owner unwarned right up to the day
 * their vault starts opening. Merging them would mean one alarm for two
 * questions and the quieter question losing.
 *
 * Public and unauthenticated, on the same terms as its two siblings and for the
 * same reason: a monitor must be able to reach it holding nothing. It exposes
 * COUNTS, rung names and ages — never an email, never an owner id, never
 * anything that says which person was not warned. `ownersExamined` is a number
 * for the same reason.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, CC9
 */

import { NextResponse } from 'next/server';
import { getReminderLadderHealth } from '../../../../../lib/release/reminder-ladder-health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const health = await getReminderLadderHealth();
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
