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

import {
  getDeliveryWebhookHealth,
  SETTLE_MS,
  WINDOW_MS,
  REFUSAL_SAMPLE_LIMIT,
} from './webhook-health';
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
  /**
   * The refusal ROWS, as the fourth query returns them: newest first, each one
   * carrying the class `refusalMarker` wrote. Classes rather than a bare count,
   * because which refusal it was is now the whole question.
   */
  refusals?: { cls: string; hoursAgo: number }[];
  acceptedSince?: number;
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
    // …and the provider is accepting. `acceptedSince` only means anything when
    // there is a refusal for it to be "since".
    refusals = [],
    acceptedSince = 0,
  } = opts;
  const refusalRows = [...refusals]
    .sort((a, b) => a.hoursAgo - b.hoursAgo) // newest first, as ORDER BY … DESC
    .map((r, i) => ({
      provider_id: `refused:${r.cls}:0000000${i}-0000-4000-8000-000000000000`,
      occurred_at: agoHours(r.hoursAgo),
    }));
  mockQuery
    .mockResolvedValueOnce(rows([{ n: String(totalEvents), newest }]))
    .mockResolvedValueOnce(rows([{ ripe: String(ripe), heard: String(heard) }]))
    .mockResolvedValueOnce(rows([{ attempts: String(attempts), orphans: String(orphans) }]))
    .mockResolvedValueOnce(rows(refusalRows))
    .mockResolvedValueOnce(rows([{ n: String(acceptedSince) }]));
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

/**
 * 🔴 THE THIRD WAY THIS SWITCH STAYS SILENT, and the one that hides the loudest
 * failure of all (found 2026-08-21).
 *
 * Everything above judges messages Resend ACCEPTED. Nothing judged the ones it
 * refused, because until this date a refusal wrote no row anywhere: `email.ts`
 * recorded an attempt only after acceptance, and `transcript.ts` is in-memory
 * and refuses to arm in production. So a revoked or wrongly-rotated
 * `RESEND_API_KEY`, a suspended shared account or a domain restriction produced
 * zero attempts, zero events, `ripeSends = 0` — and this file read that as "a
 * quiet week" and reported healthy while EVERY message Relay sent was refused.
 *
 * That is the same shape as the two defects this file was already rebuilt for,
 * and `docs/secret-rotation-runbook.md` asserted the opposite in as many words:
 * "RESEND_API_KEY fails loudly — all mail stops, and delivery-webhook-monitor.yml
 * notices."
 *
 * The condition is "refusals happened and NOTHING has been accepted since the
 * first of them" — not "any refusal at all". A key that no longer works never
 * recovers, so that condition never clears on its own.
 */
describe('a provider that refuses everything', () => {
  const DEAD_KEY = 'invalid_api_key';

  it('is UNHEALTHY when refusals happened and nothing has been accepted since', async () => {
    state({
      refusals: Array.from({ length: 9 }, () => ({ cls: DEAD_KEY, hoursAgo: 20 })),
      acceptedSince: 0,
      ripe: 0,
      heard: 0,
    });
    const h = await getDeliveryWebhookHealth(now);

    // Note ripe=0. Without this check that is indistinguishable from a quiet
    // week, which is exactly how a dead key stayed invisible.
    expect(h.healthy).toBe(false);
    expect(h.refusedSends).toBe(9);
    expect(h.systemicRefusals).toBe(9);
    expect(h.meaning).toContain('RESEND_API_KEY');
  });

  it('does NOT alarm when a message was accepted after the refusals', async () => {
    state({
      refusals: [
        { cls: DEAD_KEY, hoursAgo: 30 },
        { cls: DEAD_KEY, hoursAgo: 29 },
      ],
      acceptedSince: 5,
      ripe: 5,
      heard: 5,
    });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(true);
    expect(h.refusedSends).toBe(2);
    expect(h.acceptedSinceFirstRefusal).toBe(5);
  });

  it('stays quiet when nothing has been refused at all', async () => {
    state({ refusals: [], ripe: 3, heard: 3 });
    const h = await getDeliveryWebhookHealth(now);
    expect(h.healthy).toBe(true);

    /*
      …and `acceptedSinceFirstRefusal` is 0 because there is no first refusal for
      it to be "since". It used to COALESCE its lower bound to the start of the
      whole window and count every accepted send in it — a number on a public
      payload that did not match the field's own description. Nothing read it
      (`refusing` is guarded on the refusal count), so nothing failed; the fix is
      that the question is no longer ASKED when there is nothing to ask about.
    */
    expect(h.acceptedSinceFirstRefusal).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  /*
    🔴 THE FIX THAT MADE THIS SWITCH SURVIVABLE (2026-08-21, same day, after
    review). `email.ts` records a refusal on ANY `result.error`, and the
    commonest error Resend returns is per-message: a mistyped recipient address
    comes back as `validation_error`. The condition was `refusedSends > 0 &&
    acceptedSinceFirstRefusal === 0`, and it cleared ONLY on a later ACCEPTED
    send — inside a 30-day window, at a product that sends almost nothing.

    So one owner typo latched /api/health/delivery-webhook to 503 for up to a
    month, told an operator "Relay is currently sending no mail at all … check
    RESEND_API_KEY first" about a key that was working, and re-alarmed the daily
    monitor every morning until an unrelated message happened to be accepted.
    That is the alarm-fatigue failure this whole file is written against.
  */
  it('does not latch on a stale per-message refusal', async () => {
    state({ refusals: [{ cls: 'validation_error', hoursAgo: 24 * 10 }], acceptedSince: 0 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(true);
    expect(h.refusedSends).toBe(1); // Still counted and still reported.
    expect(h.systemicRefusals).toBe(0);
  });

  /*
    But it is not simply ignored either. Resend also returns `validation_error`
    for a sandbox account that may only mail its own owner, which IS a total
    outage — so a fresh one still reports unhealthy. It ages out; it does not
    latch. And it must not print the dead-key page, because the commonest cause
    is an address the owner typed.
  */
  it('a FRESH per-message refusal still reports, and names the right cause', async () => {
    state({ refusals: [{ cls: 'validation_error', hoursAgo: 3 }], acceptedSince: 0 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(false);
    expect(h.systemicRefusals).toBe(0);
    expect(h.meaning).not.toContain('RESEND_API_KEY');
    expect(h.meaning.toLowerCase()).toContain('address');
  });

  /*
    The comment this file carried — "a single 429 that the next message sails
    past is a provider having a moment" — described behaviour the code did not
    have: it cleared only on an ACCEPTED send, which at this volume might never
    arrive. It is now true by construction rather than by hope.
  */
  it('a single 429 followed by silence does not alarm forever', async () => {
    state({ refusals: [{ cls: 'rate_limit_exceeded', hoursAgo: 24 * 5 }], acceptedSince: 0 });
    expect((await getDeliveryWebhookHealth(now)).healthy).toBe(true);
  });

  /*
    The other direction, and the one that matters more: a dead credential must
    still latch. It never recovers on its own, so ageing it out would be the
    monitor going quiet while the fault stands — the failure this repo fears
    most, and the reason the recency rule applies ONLY to the classes that are
    not about the credential.
  */
  it('a dead key still latches however long ago it was refused', async () => {
    state({ refusals: [{ cls: DEAD_KEY, hoursAgo: 24 * 25 }], acceptedSince: 0 });
    const h = await getDeliveryWebhookHealth(now);

    expect(h.healthy).toBe(false);
    expect(h.meaning).toContain('RESEND_API_KEY');
  });

  /*
    An error name nobody has classified yet counts as an outage. An allow-list of
    known-bad classes would let a new Resend error name switch this check off
    silently, which is how the two previous versions of this file died.
  */
  it('treats an unrecognised refusal class as an outage', async () => {
    state({ refusals: [{ cls: 'some_new_resend_error', hoursAgo: 24 * 12 }], acceptedSince: 0 });
    expect((await getDeliveryWebhookHealth(now)).systemicRefusals).toBe(1);
  });

  /*
    "Since the first" must mean the first one being JUDGED, not the first one
    stored. A per-message refusal a fortnight before the credential died would
    otherwise move the lower bound back far enough to sweep up sends that
    predate the outage, and the alarm would never fire.
  */
  it('measures acceptance from the first refusal it is judging', async () => {
    state({
      refusals: [
        { cls: 'validation_error', hoursAgo: 24 * 14 },
        { cls: DEAD_KEY, hoursAgo: 24 * 2 },
      ],
      acceptedSince: 0,
    });
    await getDeliveryWebhookHealth(now);

    const since = (mockQuery.mock.calls[4][1] as Date[])[0];
    expect(since.getTime()).toBe(now.getTime() - 24 * 2 * 3600_000);
  });

  /*
    A REFUSED SEND CAN NEVER BE HEARD ABOUT — the provider never took it, so no
    webhook event will ever carry its id. Counting refusals as ripe sends would
    make `deaf` fire and send an operator to the Resend webhook configuration for
    a fault that is in the API key. Two different faults, two different pages;
    the query has to keep the populations apart.
  */
  it('excludes refusals from the sends the webhook is judged on', async () => {
    state({ refusals: [{ cls: DEAD_KEY, hoursAgo: 4 }] });
    await getDeliveryWebhookHealth(now);

    expect(String(mockQuery.mock.calls[1][0])).toContain('NOT LIKE');
    expect(String(mockQuery.mock.calls[1][0])).toContain('refused:');
  });

  it('bounds the refusal sample to the same window as everything else', async () => {
    state({ refusals: [] });
    await getDeliveryWebhookHealth(now);

    const params = mockQuery.mock.calls[3][1] as Date[];
    expect(params[0].getTime()).toBe(now.getTime() - WINDOW_MS);
  });

  /*
    The sample is capped, so it takes the NEWEST rows and not the oldest. A cap
    on the oldest could hide a credential failure behind a thousand older
    address typos; taking the newest can only move the judged start later, which
    makes the alarm likelier rather than quieter.
  */
  it('samples the newest refusals, so the cap cannot hide the current fault', async () => {
    state({ refusals: [] });
    await getDeliveryWebhookHealth(now);

    const sql = String(mockQuery.mock.calls[3][0]);
    expect(sql).toContain('DESC');
    expect(sql).toContain(`LIMIT ${REFUSAL_SAMPLE_LIMIT}`);
  });

  it('ignores a refusal row whose timestamp will not parse', async () => {
    mockQuery
      .mockResolvedValueOnce(rows([{ n: '5', newest: agoHours(2) }]))
      .mockResolvedValueOnce(rows([{ ripe: '0', heard: '0' }]))
      .mockResolvedValueOnce(rows([{ attempts: '12', orphans: '0' }]))
      .mockResolvedValueOnce(rows([{ provider_id: 'refused:transport:x', occurred_at: 'nonsense' }]))
      .mockResolvedValueOnce(rows([{ n: '0' }]));

    const h = await getDeliveryWebhookHealth(now);
    expect(h.refusedSends).toBe(0);
    expect(h.healthy).toBe(true);
  });
});
