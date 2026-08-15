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

import { GET, POST } from './route';
import { runHeartbeatSweep } from '../../../../../lib/release/heartbeat';
import { recordSchedulerRun } from '../../../../../lib/release/scheduler-ledger';
import { escalateLapsedRequests } from '../../../../../lib/release/escalation';
import { sweepSilentVerifiers } from '../../../../../lib/release/silence-sweep';

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
