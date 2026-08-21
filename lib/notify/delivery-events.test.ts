/**
 * Whose mail we are allowed to write down.
 *
 * 🔴 THIS MODULE HAD NO TEST FILE UNTIL 2026-08-15, and the thing it was
 * getting wrong needed only a `SELECT` on production to see: Relay's
 * `email_delivery_events` table held 113 rows, and **70 of them were another
 * product's mail**. The Resend account is shared with report-bridge and a Resend
 * webhook endpoint is per ACCOUNT, not per sending domain, so every event for
 * every project on that account arrived at `/api/resend/webhook` and was
 * recorded without anyone asking who sent it.
 *
 * The properties below are therefore about a boundary, not a formatter: what
 * this function refuses to store is the point of it.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  attributableToRelay,
  recordDeliveryEvent,
  recordSendRefusal,
  refusalMarker,
  refusalClassOf,
  isSystemicRefusalClass,
  NON_SYSTEMIC_REFUSAL_CLASSES,
  classify,
  MAX_DETAIL_CHARS,
} from './delivery-events';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }));
const mockQuery = vi.mocked(query);

const OURS = 'relay@relaystandby.com';

beforeEach(() => {
  mockQuery.mockClear();
  process.env.RESEND_FROM_ADDRESS = OURS;
});
afterEach(() => {
  delete process.env.RESEND_FROM_ADDRESS;
});

describe('attributableToRelay', () => {
  it('accepts a bare address on our sending domain', () => {
    expect(attributableToRelay('relay@relaystandby.com')).toBe(true);
  });

  /*
    Resend does not send a bare address. Its own documented payload for
    `email.bounced` carries `"from": "Acme <onboarding@resend.dev>"`, so a rule
    that split on the first `@` would compute `resend.dev>` — with the angle
    bracket — and match nothing, dropping every event including ours. Checked
    against the provider's example rather than assumed, 2026-08-15.
  */
  it('accepts DISPLAY FORM, which is the shape Resend actually sends', () => {
    expect(attributableToRelay('Relay <relay@relaystandby.com>')).toBe(true);
  });

  it('is case-insensitive about the domain', () => {
    expect(attributableToRelay('Relay <Relay@RelayStandby.COM>')).toBe(true);
  });

  /*
    The whole reason this function exists. These are the addresses that were
    actually on production.
  */
  it('REFUSES another product on the shared Resend account', () => {
    expect(attributableToRelay('ReportBridge <noreply@report-bridge.com>')).toBe(false);
    expect(attributableToRelay('monitor@synthetic.report-bridge.com')).toBe(false);
  });

  /*
    Matched on the domain, not the mailbox, so a second Relay sender does not
    have to be remembered here to keep working. A rule pinned to `relay@` would
    silently drop `notifications@` on the day somebody added it — and silent
    dropping is precisely the failure this module is written against.
  */
  it('accepts a DIFFERENT mailbox on our own domain', () => {
    expect(attributableToRelay('notifications@relaystandby.com')).toBe(true);
    expect(attributableToRelay('Relay Alerts <alerts@relaystandby.com>')).toBe(true);
  });

  it('is not fooled by a lookalike domain that merely ends with ours', () => {
    expect(attributableToRelay('spoof@notrelaystandby.com')).toBe(false);
    expect(attributableToRelay('spoof@relaystandby.com.evil.test')).toBe(false);
  });

  /*
    🔴 THE FAIL-SAFE DIRECTION, PINNED. Exclusion requires POSITIVE evidence that
    the event belongs to somebody else — the same direction as
    `positivelyNonProduction` in lib/ops/alert-address.ts, and for the same
    reason: this module's entire purpose is that going blind is invisible, so a
    rule that dropped whenever it was unsure could switch the sensor off without
    anybody seeing it happen. These four cases are the ones where we cannot
    judge, and they are all recorded.

    If somebody ever "tightens" this to drop-on-doubt, these fail. That is the
    point of writing them down.
  */
  describe('records when it cannot judge, rather than dropping', () => {
    it('accepts a payload with no `from` at all', () => {
      expect(attributableToRelay(undefined)).toBe(true);
      expect(attributableToRelay(null)).toBe(true);
    });

    it('accepts a `from` that is not a string', () => {
      expect(attributableToRelay(42)).toBe(true);
      expect(attributableToRelay({ address: 'x@y.com' })).toBe(true);
    });

    it('accepts a `from` with no domain to read', () => {
      expect(attributableToRelay('not-an-address')).toBe(true);
      expect(attributableToRelay('trailing@')).toBe(true);
    });

    it('accepts everything when RELAY has no configured sending domain', () => {
      delete process.env.RESEND_FROM_ADDRESS;
      // Unchanged from the behaviour before the guard existed: a misconfigured
      // Relay must not end up with a quieter sensor than an unguarded one.
      expect(attributableToRelay('anyone@report-bridge.com')).toBe(true);
    });
  });
});

describe('recordDeliveryEvent', () => {
  it('writes an event that is ours', async () => {
    await recordDeliveryEvent({
      email: 'Alex@Example.org',
      event: 'email.delivered',
      from: 'Relay <relay@relaystandby.com>',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // Address is normalised, because the reader keys on it.
    expect(mockQuery.mock.calls[0][1]?.[0]).toBe('alex@example.org');
  });

  /*
    THE DATABASE IS NEVER TOUCHED for another product's mail. Asserting on the
    absence of the query rather than on a returned flag is deliberate: the defect
    was a row existing, so the property is that no write is attempted at all.
  */
  it('writes NOTHING for another product on the shared account', async () => {
    await recordDeliveryEvent({
      email: 'synth-probe-1@synthetic.report-bridge.com',
      event: 'email.bounced',
      from: 'ReportBridge Monitor <monitor@report-bridge.com>',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still writes when the payload names no sender', async () => {
    await recordDeliveryEvent({ email: 'alex@example.org', event: 'email.delivered' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a blank address', async () => {
    await recordDeliveryEvent({ email: '   ', event: 'email.delivered', from: OURS });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  /*
    Our message bodies carry live access codes. A provider that echoed one back
    inside a bounce reason would turn a diagnostic table into a credential store,
    so the reason is bounded on the way in as well as at the route.
  */
  it('bounds the detail a provider can write into our rows', async () => {
    await recordDeliveryEvent({
      email: 'alex@example.org',
      event: 'email.bounced',
      detail: 'x'.repeat(MAX_DETAIL_CHARS + 500),
      from: OURS,
    });
    expect((mockQuery.mock.calls[0][1]?.[2] as string).length).toBe(MAX_DETAIL_CHARS);
  });
});

describe('classify', () => {
  it('treats a complaint as undeliverable, like a bounce', () => {
    // Not the same event, but the same instruction: stop mailing this person.
    expect(classify('email.complained')).toBe('undeliverable');
    expect(classify('email.bounced')).toBe('undeliverable');
  });

  it('never invents a reassuring verdict for an event it does not know', () => {
    expect(classify('email.opened')).toBe('unknown');
    expect(classify('')).toBe('unknown');
  });
});

/**
 * 🔴 THE HALF OF THE SWITCH THAT WAS NEVER RECORDED (found 2026-08-21).
 *
 * `recordSendAttempt` runs only AFTER Resend has accepted a message. So a
 * revoked or wrongly-rotated `RESEND_API_KEY`, a suspended shared account, a
 * sending-domain restriction — any 4xx — wrote nothing at all: zero attempt
 * rows, zero events, `/api/health/delivery-webhook` reading "a quiet week" and
 * answering 200, and the only trace a `[notify] email … failed` line in a log
 * that ages out in a day. The dead-man's switch would have armed and rung a
 * bell nobody hears, and `docs/secret-rotation-runbook.md` claimed the exact
 * opposite: "RESEND_API_KEY fails loudly — all mail stops, and
 * delivery-webhook-monitor.yml notices."
 *
 * A refusal is now an attempt row too, marked so it can never be mistaken for
 * an accepted send. No new column, so this works on a cluster today rather than
 * after a migration lands.
 */
describe('recordSendRefusal', () => {
  it('writes an attempt row a Resend id can never collide with', async () => {
    await recordSendRefusal('validation_error');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO email_send_attempts');
    expect(String(params[0])).toMatch(/^refused:validation_error:/);
  });

  it('gives every refusal its own row, so two are two', async () => {
    await recordSendRefusal('rate_limit_exceeded');
    await recordSendRefusal('rate_limit_exceeded');
    const first = (mockQuery.mock.calls[0] as [string, unknown[]])[1][0];
    const second = (mockQuery.mock.calls[1] as [string, unknown[]])[1][0];
    expect(first).not.toBe(second);
  });

  /*
    THE MARKER IS TELEMETRY, NOT A LOG LINE. This table is deliberately the least
    personal thing Relay stores — an id and a timestamp, no recipient and no body
    (migration 031) — and a provider error message can quote the address it
    refused. So an input that looks anything like an address never becomes a
    marker, and the rest is reduced to a bounded class name.
  */
  it('never lets an address become a marker', async () => {
    await recordSendRefusal('bounced: alex@example.org is suppressed');
    const marker = String((mockQuery.mock.calls[0] as [string, unknown[]])[1][0]);
    expect(marker).toMatch(/^refused:unknown:/);
    expect(marker).not.toContain('alex');
    expect(marker).not.toContain('example');
  });

  it('bounds and normalises the class name', async () => {
    await recordSendRefusal('  Validation Error!!  ');
    expect(String((mockQuery.mock.calls[0] as [string, unknown[]])[1][0])).toMatch(
      /^refused:validation_error:/,
    );

    mockQuery.mockClear();
    await recordSendRefusal('x'.repeat(200));
    const marker = String((mockQuery.mock.calls[0] as [string, unknown[]])[1][0]);
    expect(marker.split(':')[1]).toHaveLength(40);
  });

  it('falls back to a class rather than writing nothing at all', async () => {
    await recordSendRefusal('   ');
    expect(String((mockQuery.mock.calls[0] as [string, unknown[]])[1][0])).toMatch(
      /^refused:unknown:/,
    );
  });

  /*
    Same direction as `recordSendAttempt`, and for the same reason: telemetry
    must never be able to fail the thing it measures. A dropped refusal row makes
    the switch slightly less likely to fire, never more.
  */
  it('swallows a database failure — it is telemetry about an error, mid-error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DSQL unreachable'));
    await expect(recordSendRefusal('validation_error')).resolves.toBeUndefined();
  });
});

/**
 * 🔴 EVERY REFUSAL WAS THE SAME REFUSAL, and one of them is not an outage.
 *
 * `webhook-health.ts` read `refusedSends > 0 && acceptedSinceFirstRefusal === 0`
 * as "Relay is currently sending no mail at all — check RESEND_API_KEY first".
 * But `email.ts` records a refusal on ANY `result.error`, and Resend's commonest
 * error is per-message: a bad recipient address. At a product that sends rarely,
 * one owner typo therefore latched the public health endpoint to 503 for up to
 * the whole 30-day window — clearing only if some later message happened to be
 * accepted — and sent an operator to rotate a key that was working.
 *
 * The marker already carries the answer: `refused:<class>:<uuid>`, written by
 * `refusalMarker` from the provider's own error name. It was never read back.
 * These two functions are the reader, and they live HERE, beside the writer, so
 * the marker format has exactly one definition.
 */
describe('reading a refusal marker back', () => {
  it('recovers the class the writer put in', () => {
    expect(refusalClassOf(refusalMarker('validation_error'))).toBe('validation_error');
    expect(refusalClassOf(refusalMarker('  Rate Limit Exceeded '))).toBe('rate_limit_exceeded');
  });

  /*
    An accepted send stores Resend's own id, which is a UUID. Reading a class out
    of one would invent a refusal that never happened, so the parser refuses
    anything without the marker prefix rather than splitting on ':' and hoping.
  */
  it('is not a refusal unless it carries the marker prefix', () => {
    expect(refusalClassOf('4a3b2c1d-0000-4000-8000-000000000000')).toBeNull();
    expect(refusalClassOf('')).toBeNull();
    expect(refusalClassOf('refused:')).toBeNull();
  });

  it('classifies a bad recipient address as NOT an outage', () => {
    expect(isSystemicRefusalClass('validation_error')).toBe(false);
    expect(isSystemicRefusalClass('bounced')).toBe(false);
    // The provider having a moment is not the provider refusing us either.
    expect(isSystemicRefusalClass('rate_limit_exceeded')).toBe(false);
  });

  it('classifies the credential and account failures as an outage', () => {
    for (const cls of [
      'invalid_api_key',
      'missing_api_key',
      'restricted_api_key',
      'restricted',
      'not_authorized',
      'invalid_from_address',
      'daily_quota_exceeded',
      // Ours, from email.ts: the provider could not be reached at all, and a
      // 200 with no message id.
      'transport',
      'no_message_id',
    ]) {
      expect(isSystemicRefusalClass(cls), cls).toBe(true);
    }
  });

  /*
    THE DEFAULT IS TO ALARM, and it is the whole reason this is a deny-list of
    known-harmless classes rather than an allow-list of known-bad ones. Resend
    can add an error name tomorrow; an allow-list would silently stop noticing
    the outage that name describes, which is the exact shape of defect this
    monitor has now been rebuilt for three times. A name we do not recognise is
    treated as an outage and reported, which is loud and correctable.
  */
  it('treats an error name nobody has seen before as an outage', () => {
    expect(isSystemicRefusalClass('some_new_resend_error')).toBe(true);
    expect(isSystemicRefusalClass('unknown')).toBe(true);
  });

  it('every entry in the deny-list is a class the writer could actually produce', () => {
    // `refusalMarker` lowercases, collapses to [a-z0-9_] and truncates. A
    // deny-list entry outside that alphabet can never match a stored marker, so
    // it would be a rule that reads as active and is dead.
    for (const cls of NON_SYSTEMIC_REFUSAL_CLASSES) {
      expect(refusalClassOf(refusalMarker(cls)), cls).toBe(cls);
    }
  });
});
