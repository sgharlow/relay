/**
 * The mail dead-man's switch, and the reason it needed rebuilding.
 *
 * 🔴 EVERY TEST IN THE ORIGINAL VERSION OF THIS FILE PASSED WHILE THE SWITCH
 * WAS INCAPABLE OF FIRING. `healthy` was `count(*) > 0` over an append-only
 * table, so once the first event ever landed it was true forever — and 113 rows
 * had landed. The suite proved the false branch by feeding it a count of zero,
 * a state production could never return to. That is the tell, and it is worth
 * naming: a test can hold a monitor's behaviour exactly right and still say
 * nothing about whether the monitor is reachable from where the system actually
 * is.
 *
 * So the properties below are written against the two ways this can now be
 * wrong — firing when it should not, and staying silent when it should not.
 *
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getDeliveryWebhookHealth, SETTLE_MS } from './webhook-health';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);

const now = new Date('2026-08-15T12:00:00.000Z');
const agoHours = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

const rows = (r: unknown[]) =>
  ({ rows: r, rowCount: r.length, command: '', oid: 0, fields: [] }) as never;

/**
 * The two round trips the check makes, in order: the events summary, then the
 * per-send comparison. Named parameters rather than positional mocks so a test
 * reads as the situation it describes.
 */
function state(opts: {
  newest?: string | null;
  totalEvents?: number;
  ripe?: number;
  heard?: number;
  attempts?: number;
  orphans?: number;
}) {
  const {
    newest = agoHours(2),
    totalEvents = 5,
    ripe = 0,
    heard = 0,
    // Defaults describe a healthy steady state: the recorder has written rows
    // and every event we hold matches one of them.
    attempts = 12,
    orphans = 0,
  } = opts;
  mockQuery
    .mockResolvedValueOnce(rows([{ n: String(totalEvents), newest }]))
    .mockResolvedValueOnce(rows([{ ripe: String(ripe), heard: String(heard) }]))
    .mockResolvedValueOnce(rows([{ attempts: String(attempts), orphans: String(orphans) }]));
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
    state({ newest: null, totalEvents: 0 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(false);
    expect(h.healthy).toBe(false);
    expect(h.totalEvents).toBe(0);
  });

  it('is healthy when events arrive for the messages we send', async () => {
    state({ newest: agoHours(2), ripe: 4, heard: 4 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(true);
    expect(h.healthy).toBe(true);
    expect(h.ageSeconds).toBeGreaterThan(7000);
  });

  /*
    🔴 THE CONDITION THAT DID NOT EXIST, AND IS THE WHOLE POINT OF THE REBUILD.
    Events have arrived in the past — `everHeard` is true and will stay true
    forever, because the table is append-only — and the stream has since stopped.
    Under the previous implementation this state answered 200 and the daily
    GitHub Actions probe passed. It is the exact scenario the monitor's own
    header describes: "that endpoint can be deleted in a dashboard, or its
    signing secret rotated, and nothing in the application would notice."
  */
  it('is UNHEALTHY when we sent and heard nothing back, even though we heard before', async () => {
    state({ newest: agoHours(24 * 9), totalEvents: 113, ripe: 6, heard: 0 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(true); // latched true — and no longer sufficient
    expect(h.healthy).toBe(false);
    expect(h.ripeSends).toBe(6);
    expect(h.ripeSendsHeard).toBe(0);
  });

  /*
    ⚠️ AND IT STILL DOES NOT ALARM ON QUIET. Relay's sending is bursty by design
    — a release is a rare event and most weeks should send almost nothing. A
    freshness threshold would fire on ordinary silence, and a monitor that cries
    wolf is a monitor that gets muted, which is how the canary's own header says
    these things die. Age is REPORTED so a human can judge it; it decides
    nothing. The judgement is made against sends, and a month with no sends
    supports no judgement at all.
  */
  it('does not call a long quiet period unhealthy — low volume is the design', async () => {
    state({ newest: agoHours(24 * 30), ripe: 0, heard: 0 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(true);
    expect(h.ageSeconds).toBeGreaterThan(2_000_000);
  });

  /*
    A SINGLE SLOW MESSAGE IS NOT A DEAD PIPE. `email.delivery_delayed` exists
    because receiving servers defer; greylisting on a first contact can hold a
    message for an hour. Partial silence is reported and never decides — only
    total silence about every ripe send does.
  */
  it('does not alarm when some sends were reported and some were not', async () => {
    state({ ripe: 5, heard: 1 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(true);
    expect(h.ripeSends).toBe(5);
    expect(h.ripeSendsHeard).toBe(1);
  });

  /*
    THE SETTLE WINDOW IS APPLIED IN SQL, so what this asserts is that the check
    asks for it — a send made a minute ago must not be inside the set being
    judged. Reading the bind parameter is the only way to see that from here, and
    an off-by-one on this bound is the difference between a useful monitor and
    one that fires every time somebody signs up.
  */
  it('judges only sends old enough to have been reported on', async () => {
    state({ ripe: 0, heard: 0 });
    await getDeliveryWebhookHealth(now);

    const params = mockQuery.mock.calls[1][1] as Date[];
    expect(params[0].getTime()).toBe(now.getTime() - SETTLE_MS);
    // ...and the trailing edge is older still, so the window is not inverted.
    expect(params[1].getTime()).toBeLessThan(params[0].getTime());
  });

  /*
    🔴 THE SECOND WAY THIS SWITCH GETS DISARMED, and the reason these three
    exist. Every condition above rests on `email_send_attempts` having rows.
    `recordSendAttempt` swallows its own failures on purpose — telemetry must not
    be able to fail a send — so if it stops writing, `ripeSends` falls to zero,
    that reads as a quiet week, and this file goes back to answering healthy
    forever. The same defect as before, one layer down, and reachable by exactly
    the thing that already happened once: a privilege change on a table.
  */
  describe('the send-side recorder is itself watched', () => {
    it('is UNHEALTHY when events arrive for messages we have no send record for', async () => {
      state({ attempts: 40, orphans: 3, ripe: 0, heard: 0 });
      const h = await getDeliveryWebhookHealth(now);

      // Note ripe=0: without this check that is indistinguishable from quiet.
      expect(h.healthy).toBe(false);
      expect(h.orphanEvents).toBe(3);
      expect(h.meaning).toContain('recordSendAttempt');
    });

    /*
      ⚠️ AND IT MUST NOT ALARM ON THE DAY IT SHIPS. Every event recorded before
      the recorder existed has no attempt row and never will. If the orphan count
      were not bounded to events at or after the first attempt, deploying this
      would fire immediately, about mail that was sent perfectly well — and an
      alarm that is wrong the first time it speaks is one nobody believes the
      second time.
    */
    it('does not alarm before the recorder has ever written a row', async () => {
      state({ attempts: 0, orphans: 0, totalEvents: 113 });
      const h = await getDeliveryWebhookHealth(now);

      expect(h.writerProven).toBe(false);
      expect(h.healthy).toBe(true);
      expect(h.meaning).toContain('UNPROVEN');
    });

    it('says so plainly once the recorder is working', async () => {
      state({ attempts: 12, orphans: 0, ripe: 3, heard: 3 });
      const h = await getDeliveryWebhookHealth(now);

      expect(h.writerProven).toBe(true);
      expect(h.healthy).toBe(true);
    });
  });

  it('survives a malformed timestamp without claiming an age it does not have', async () => {
    state({ newest: 'not-a-date' });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.everHeard).toBe(true);
    expect(h.ageSeconds).toBeNull();
  });

  describe('says what it means, because an alert nobody can act on is noise', () => {
    it('names the screen that goes blind when nothing has ever arrived', async () => {
      state({ newest: null, totalEvents: 0 });
      const h = await getDeliveryWebhookHealth(now);
      expect(h.meaning.toLowerCase()).toContain('deliveryline');
    });

    /*
      The two failures need DIFFERENT instructions. "Never configured" and "was
      working and stopped" send an operator to different places, and a monitor
      that says the same thing either way makes them find that out themselves.
    */
    it('names the signing secret when a working stream has stopped', async () => {
      state({ newest: agoHours(24 * 9), totalEvents: 113, ripe: 6, heard: 0 });
      const h = await getDeliveryWebhookHealth(now);
      expect(h.meaning).toContain('RESEND_WEBHOOK_SECRET');
      expect(h.meaning).toContain('6 message(s)');
    });
  });
});
