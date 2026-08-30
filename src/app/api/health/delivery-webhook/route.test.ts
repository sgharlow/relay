/**
 * The dead-man's switch for mail telemetry.
 *
 * This handler executed no test until 2026-08-30. It answers the question that
 * decides whether `/circle`'s reachability column means anything: has any
 * provider event ever arrived at all? Until one has, every address on that
 * screen reads `null` — "we have not heard" — and the screen is silently blind
 * rather than wrong.
 *
 * 🔴 IT DELIBERATELY DOES NOT GO 503 ON A QUIET PERIOD. Relay sends rarely by
 * design, so "no events this week" is normal and must never alarm; "no event has
 * EVER arrived" is a broken webhook and must. That distinction lives in
 * `lib/notify/webhook-health.ts`, and the route's job is to carry its verdict
 * without adding a second opinion — which is what the third test pins.
 *
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/notify/webhook-health', () => ({
  getDeliveryWebhookHealth: vi.fn(),
}));

import { getDeliveryWebhookHealth } from '../../../../../lib/notify/webhook-health';
import { GET } from './route';

const mockHealth = vi.mocked(getDeliveryWebhookHealth);

const HEALTHY = { healthy: true, eventCount: 42, lastEventAt: '2026-08-29T00:00:00.000Z' };
const NEVER = { healthy: false, eventCount: 0, lastEventAt: null };
const QUIET = { healthy: true, eventCount: 42, lastEventAt: '2026-07-01T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mockHealth.mockResolvedValue(HEALTHY as never);
});

describe('the code a monitor reads', () => {
  it('answers 200 when events are arriving', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(HEALTHY);
  });

  it('answers 503 when no provider event has ever arrived', async () => {
    mockHealth.mockResolvedValueOnce(NEVER as never);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(NEVER);
  });

  it('stays 200 through a long quiet period, because Relay sends rarely', async () => {
    // Alarming here would train an operator to ignore this probe, which is the
    // only failure worse than not having it.
    mockHealth.mockResolvedValueOnce(QUIET as never);
    expect((await GET()).status).toBe(200);
  });
});

describe('what an unauthenticated caller may see', () => {
  it('exposes a count and a timestamp, nothing about any recipient', async () => {
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/@/);
    expect(body).not.toMatch(/recipient|owner_id|ownerId/i);
  });
});
