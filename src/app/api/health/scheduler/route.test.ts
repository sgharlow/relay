/**
 * The CC9 dead-man's-switch probe.
 *
 * This handler executed no test until 2026-08-30 — the probe that
 * `.github/workflows/scheduler-monitor.yml` has been alarming on, untested.
 *
 * 🔴 THE STATUS CODE IS THE ENTIRE PRODUCT OF THIS ROUTE. A monitor reads the
 * code, not the body. If an unhealthy ledger ever answered 200, every alarm
 * built on this endpoint would go quiet and the silence would look like health —
 * which is the exact failure mode the dead-man exists to rule out. So the
 * mapping `healthy → 200 / unhealthy → 503` is asserted in both directions
 * rather than on the happy path alone.
 *
 * ⚠️ PUBLIC AND UNAUTHENTICATED BY DESIGN. A monitor must reach it holding
 * nothing. That is only safe while the body stays a timestamp, an age and a
 * boolean, so the last test names what must never appear here.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/release/scheduler-ledger', () => ({
  getSchedulerHealth: vi.fn(),
}));

import { getSchedulerHealth } from '../../../../../lib/release/scheduler-ledger';
import { GET } from './route';

const mockHealth = vi.mocked(getSchedulerHealth);

const HEALTHY = { healthy: true, lastRunAt: '2026-08-30T06:00:00.000Z', ageSeconds: 120 };
const STALE = { healthy: false, lastRunAt: '2026-08-28T06:00:00.000Z', ageSeconds: 172800 };

beforeEach(() => {
  vi.clearAllMocks();
  mockHealth.mockResolvedValue(HEALTHY as never);
});

describe('the code a monitor reads', () => {
  it('answers 200 while the sweep is running inside its threshold', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(HEALTHY);
  });

  it('answers 503 when the sweep has gone quiet', async () => {
    // The direction that matters. A 200 here would silence every alarm built on
    // this endpoint while the scheduler was dead.
    mockHealth.mockResolvedValueOnce(STALE as never);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(STALE);
  });

  it('reports the ledger verbatim rather than re-deciding health here', async () => {
    // One definition of "healthy", in the ledger. A second opinion in the route
    // is how a probe and its own library come apart.
    mockHealth.mockResolvedValueOnce({ healthy: false, whatever: 1 } as never);
    expect((await GET()).status).toBe(503);
  });
});

describe('what an unauthenticated caller may see', () => {
  it('exposes no owner id, email or vault detail', async () => {
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/@/);
    expect(body).not.toMatch(/owner_id|ownerId|email/i);
  });
});
