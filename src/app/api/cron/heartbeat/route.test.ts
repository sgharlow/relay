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

import { GET, POST } from './route';
import { runHeartbeatSweep } from '../../../../../lib/release/heartbeat';
import { recordSchedulerRun } from '../../../../../lib/release/scheduler-ledger';

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
