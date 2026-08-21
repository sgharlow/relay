/**
 * Tests for the cron heartbeat route.
 *
 * Vercel Cron invokes cron paths with GET. This route exported only POST, and
 * no crons declaration existed in the repo, so runHeartbeatSweep never ran on
 * the live deployment — R4.6 was unimplemented in production while the suite
 * stayed green, because nothing tested that the sweep was scheduled.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.6, 4.7, CC9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/release/heartbeat', () => ({
  // SweepResult is { evaluated, transitioned, failures } — verified against
  // lib/release/heartbeat.ts. Do not guess these field names.
  runHeartbeatSweep: vi.fn(async () => ({ evaluated: 3, transitioned: 1, failures: 0 })),
  // The other half of the sweep: GRACE rows whose window elapsed and whose
  // quorum is already met. Without it, GRACE_WINDOW_MS could not be raised
  // above 0 without stranding releases.
  resolveElapsedGrace: vi.fn(async () => 0),
}));
vi.mock('../../../../../lib/release/state-machine', () => ({
  ReleaseStateMachine: class {},
}));
vi.mock('../../../../../lib/release/scheduler-ledger', () => ({
  recordSchedulerRun: vi.fn(async () => undefined),
}));
// Requests the owner never answered. It rides this cron rather than a reader
// because the reader it is specified against — a verifier's standby dashboard —
// does not exist yet, and this scheduler is already running.
vi.mock('../../../../../lib/release/escalation', () => ({
  escalateLapsedRequests: vi.fn(async () => []),
}));
// The other direction of the same silence: the VERIFIERS not answering. Rides
// this cron for the same reason and moves no state — it sends the owner the
// phone numbers already in their circle. Behaviour is covered by
// lib/release/silence-sweep.test.ts; here it only has to be called.
vi.mock('../../../../../lib/release/silence-sweep', () => ({
  sweepSilentVerifiers: vi.fn(async () => []),
}));
// The nudge that goes to the OWNER before their dead-man's switch fires (J5-R4).
// Behaviour is covered by lib/release/checkin-reminder.test.ts; here it only has
// to be called, on the same run, after everything that moves state.
vi.mock('../../../../../lib/release/checkin-reminder', () => ({
  sweepCheckinReminders: vi.fn(async () => []),
}));

import { GET, POST } from './route';
import { runHeartbeatSweep } from '../../../../../lib/release/heartbeat';
import { recordSchedulerRun } from '../../../../../lib/release/scheduler-ledger';
import { escalateLapsedRequests } from '../../../../../lib/release/escalation';
import { sweepSilentVerifiers } from '../../../../../lib/release/silence-sweep';
import { sweepCheckinReminders } from '../../../../../lib/release/checkin-reminder';

function req(authz?: string) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (authz ?? null) : null) },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

describe('cron heartbeat route', () => {
  it('exports a GET handler — Vercel Cron sends GET', () => {
    expect(typeof GET).toBe('function');
  });

  it('GET runs the sweep when the secret matches', async () => {
    const res = await GET(req('Bearer test-secret'));

    expect(res.status).toBe(200);
    expect(runHeartbeatSweep).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ evaluated: 3, transitioned: 1 });
  });

  it('GET rejects a wrong secret without running the sweep', async () => {
    const res = await GET(req('Bearer wrong'));

    expect(res.status).toBe(401);
    expect(runHeartbeatSweep).not.toHaveBeenCalled();
  });

  it('GET rejects a missing authorization header', async () => {
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(runHeartbeatSweep).not.toHaveBeenCalled();
  });

  it('GET rejects when CRON_SECRET is unset — never runs unauthenticated', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(req('Bearer test-secret'));

    expect(res.status).toBe(401);
    expect(runHeartbeatSweep).not.toHaveBeenCalled();
  });

  it('records every successful run to the scheduler ledger (CC9)', async () => {
    await GET(req('Bearer test-secret'));

    expect(recordSchedulerRun).toHaveBeenCalledWith({
      evaluated: 3,
      transitioned: 1,
      failures: 0,
    });
  });

  it('does NOT record a ledger entry when authorization fails', async () => {
    await GET(req('Bearer wrong'));

    expect(recordSchedulerRun).not.toHaveBeenCalled();
  });

  it('POST still works for manual invocation', async () => {
    const res = await POST(req('Bearer test-secret'));

    expect(res.status).toBe(200);
    expect(runHeartbeatSweep).toHaveBeenCalledTimes(1);
  });
});

/**
 * The escalation sweep must be part of the SAME scheduled run. If it were only
 * wired to a reader it would never fire for an incapacitated owner — nobody is
 * looking, which is the whole reason the request is stuck.
 */
describe('cron heartbeat route — lapsed challenge escalation', () => {
  it('sweeps lapsed access requests on the same run and reports the count', async () => {
    vi.mocked(escalateLapsedRequests).mockResolvedValueOnce([
      { requestId: 'r-1', caseId: 'RLY-A', ownerId: 'o-1', triggerType: 'emergency', releaseStateId: 'rs-1' },
    ] as never);

    const res = await GET(req('Bearer test-secret'));

    expect(escalateLapsedRequests).toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ escalated: 1 });
  });

  it('does not run the sweep for an unauthorized caller', async () => {
    await GET(req('Bearer wrong'));
    expect(escalateLapsedRequests).not.toHaveBeenCalled();
  });
});

/**
 * The other direction: the VERIFIERS going quiet.
 *
 * `escalateLapsedRequests` covers an owner who never answered. Nothing covered a
 * verifier who never answered — now the likelier failure, because their notice
 * is the message whose silent loss stalls a release, and a junked notice looks
 * exactly like a delivered one from inside this product. It has to ride the same
 * scheduled run for the same reason: during an emergency nobody is looking at a
 * screen, which is what makes the silence invisible in the first place.
 */
describe('cron heartbeat route — silent verifiers', () => {
  it('sweeps for silent verifiers on the same run and reports the count', async () => {
    vi.mocked(sweepSilentVerifiers).mockResolvedValueOnce(['rs-1'] as never);

    const res = await GET(req('Bearer test-secret'));

    expect(sweepSilentVerifiers).toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ silenceNotices: 1 });
  });

  it('does not run it for an unauthorized caller', async () => {
    await GET(req('Bearer wrong'));
    expect(sweepSilentVerifiers).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 THE OWNER HAD NO WARNING AT ALL — J5-R4, closed 2026-08-21.
 *
 * A living owner who missed ONE interval had their verifiers asked whether they
 * were incapacitated, and the first thing the owner heard was the message saying
 * it had already started. The reminder rides this cron for the reason the other
 * two sweeps here already give: it is the scheduler that is already running, and
 * a second thing that can silently stop is worse than a slightly busier sweep.
 *
 * ⚠️ THE ORDERING ASSERTIONS BELOW ARE THE POINT. A reminder must never be able
 * to delay the transition it warns about, nor to break the ledger whose absence
 * is the dead-man's alarm for the scheduler itself.
 */
describe('cron heartbeat route — the pre-PENDING owner reminder', () => {
  it('sweeps for owners approaching their deadline and reports the count', async () => {
    vi.mocked(sweepCheckinReminders).mockResolvedValueOnce(['owner-1'] as never);

    const res = await GET(req('Bearer test-secret'));

    expect(sweepCheckinReminders).toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ checkinReminders: 1 });
  });

  it('does not run it for an unauthorized caller', async () => {
    await GET(req('Bearer wrong'));
    expect(sweepCheckinReminders).not.toHaveBeenCalled();
  });

  it('runs AFTER the heartbeat sweep, so it can never postpone an arming', async () => {
    await GET(req('Bearer test-secret'));

    const swept = vi.mocked(runHeartbeatSweep).mock.invocationCallOrder[0];
    const reminded = vi.mocked(sweepCheckinReminders).mock.invocationCallOrder[0];
    expect(
      reminded,
      'the reminder now runs before the sweep that arms overdue triggers',
    ).toBeGreaterThan(swept);
  });

  it('runs AFTER the scheduler ledger, so a nudge failure cannot forge a dead scheduler', async () => {
    /*
      `recordSchedulerRun` is what /api/health/scheduler reads, and its ABSENCE is
      the off-Vercel dead-man's switch. If the reminder ran first and threw, the
      ledger row would never be written and the monitor would report that the
      product's dead-man's switch had stopped — because an email did not send.
    */
    await GET(req('Bearer test-secret'));

    const ledger = vi.mocked(recordSchedulerRun).mock.invocationCallOrder[0];
    const reminded = vi.mocked(sweepCheckinReminders).mock.invocationCallOrder[0];
    expect(reminded).toBeGreaterThan(ledger);
  });
});
