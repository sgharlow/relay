/**
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getDeliveryWebhookHealth } from './webhook-health';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);

const now = new Date('2026-08-15T12:00:00.000Z');
const agoHours = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

function heard(newest: string | null, total = 5) {
  mockQuery.mockResolvedValue({
    rows: [{ n: String(total), newest }],
    rowCount: 1,
    command: '',
    oid: 0,
    fields: [],
  } as never);
}

beforeEach(() => mockQuery.mockReset());

describe('getDeliveryWebhookHealth', () => {
  /*
    🔴 THE FAILURE THIS EXISTS FOR. DeliveryLine renders NOTHING until the
    webhook is configured and that address has been mailed. If the endpoint is
    deleted, or its signing secret rotates, events stop arriving and the circle
    screen goes back to saying nothing — which looks exactly like "no news"
    rather than "the sensor is dead". Silent blindness is the worst shape a
    monitoring surface can fail in, and this product has been caught by it
    before.
  */
  it('is UNHEALTHY when no event has ever arrived — the webhook is unproven', async () => {
    heard(null, 0);
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(false);
    expect(h.healthy).toBe(false);
    expect(h.totalEvents).toBe(0);
  });

  it('is healthy once anything has been heard', async () => {
    heard(agoHours(2));
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(true);
    expect(h.healthy).toBe(true);
    expect(h.ageSeconds).toBeGreaterThan(7000);
  });

  /*
    ⚠️ AND IT DELIBERATELY DOES NOT ALARM ON QUIET. Relay's sending is bursty by
    design — a release is a rare event and most weeks should send almost
    nothing. A freshness threshold here would fire on ordinary silence, and a
    monitor that cries wolf is a monitor that gets muted, which is how the
    canary's own header says these things die. Age is REPORTED so a human can
    judge it; it does not decide `healthy`.
  */
  it('does not call a long quiet period unhealthy — low volume is the design', async () => {
    heard(agoHours(24 * 30));
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(true);
    expect(h.ageSeconds).toBeGreaterThan(2_000_000);
  });

  it('survives a malformed timestamp without claiming an age it does not have', async () => {
    heard('not-a-date');
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(true);
    expect(h.ageSeconds).toBeNull();
  });

  it('states the consequence in words, so an alert is actionable at 3am', async () => {
    heard(null, 0);
    const h = await getDeliveryWebhookHealth(now);
    expect(h.meaning.toLowerCase()).toContain('deliveryline');
  });
});
