/**
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Resend } from 'resend';

import { _setResendClientForTesting } from '../notify/email';
import { sweepSilentVerifiers, VERIFIER_SILENCE_ACTION } from './silence-sweep';
import { VERIFIER_SILENCE_WINDOW_MS } from './quiet-channel';
import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => undefined) }));
const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);

const sent: Array<{ to: string; subject: string; text: string }> = [];

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

const now = new Date('2026-08-14T18:00:00.000Z');
const longAgo = new Date(now.getTime() - VERIFIER_SILENCE_WINDOW_MS - 60_000).toISOString();

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const RELEASE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

interface World {
  releases?: unknown[];
  verifiers?: unknown[];
  answered?: unknown[];
  alreadyNotified?: boolean;
}

function world(w: World = {}) {
  const releases = w.releases ?? [
    {
      id: RELEASE,
      owner_id: OWNER,
      trigger_type: 'emergency',
      state: 'pending',
      initiated_at: longAgo,
      received_confirmations: 0,
      required_confirmations: 2,
    },
  ];
  const verifiers = w.verifiers ?? [
    { id: 'v1', name: 'Lee', phone: '+1 555 0100', standby_state: 'confirmed' },
    { id: 'v2', name: 'Sam', phone: null, standby_state: 'confirmed' },
  ];

  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM release_state')) return qResult(releases);
    if (sql.includes('FROM audit_log')) return qResult(w.alreadyNotified ? [{ n: '1' }] : []);
    if (sql.includes('FROM verifiers')) return qResult(verifiers);
    if (sql.includes('FROM verifier_confirmations')) return qResult(w.answered ?? []);
    if (sql.includes('FROM users')) return qResult([{ email: 'owner@example.net' }]);
    return qResult([]);
  });
}

function stubResend(): Resend {
  return {
    emails: {
      send: vi.fn(async (msg: { to: string; subject: string; text: string }) => {
        sent.push(msg);
        return { data: { id: 'mail-1' }, error: null };
      }),
    },
  } as unknown as Resend;
}

beforeEach(() => {
  sent.length = 0;
  mockQuery.mockReset();
  mockAudit.mockClear();
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.NEXTAUTH_URL = 'https://relay.test';
  _setResendClientForTesting(stubResend());
});
afterEach(() => _setResendClientForTesting(null));

describe('sweepSilentVerifiers', () => {
  it('tells the owner, naming who has not answered and how to ring them', async () => {
    world();
    const out = await sweepSilentVerifiers(now);

    expect(out).toEqual([RELEASE]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('owner@example.net');
    expect(sent[0].text).toContain('Lee');
    expect(sent[0].text).toContain('+1 555 0100');
    expect(sent[0].text).toContain('Sam');
  });

  /*
    THE MESSAGE HAS TO SAY THE THING THE PRODUCT CANNOT DO. Every other notice
    in this file asks somebody to go to a screen. This one exists because the
    screen and the inbox may both be silent, so it has to hand the reader a
    channel Relay does not own.
  */
  it('tells the reader to use a phone rather than to wait', async () => {
    world();
    await sweepSilentVerifiers(now);
    expect(sent[0].text.toLowerCase()).toMatch(/phone|ring|call/);
  });

  it('says nothing while the release is still inside the window', async () => {
    world({
      releases: [
        {
          id: RELEASE,
          owner_id: OWNER,
          trigger_type: 'emergency',
          state: 'pending',
          initiated_at: new Date(now.getTime() - 60_000).toISOString(),
          received_confirmations: 0,
          required_confirmations: 2,
        },
      ],
    });
    expect(await sweepSilentVerifiers(now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('says nothing once quorum has been reached', async () => {
    world({
      releases: [
        {
          id: RELEASE,
          owner_id: OWNER,
          trigger_type: 'emergency',
          state: 'grace',
          initiated_at: longAgo,
          received_confirmations: 2,
          required_confirmations: 2,
        },
      ],
    });
    expect(await sweepSilentVerifiers(now)).toEqual([]);
  });

  /*
    🔴 THE SWEEP RUNS HOURLY. Without a marker this would mail the owner every
    hour for as long as the release stayed open — during their emergency. The
    audit entry IS the marker, the same pattern reserveInviteEmail uses, so
    there is no new table and the owner can see in their own trail that we sent
    it.
  */
  it('sends once per release, not once per sweep', async () => {
    world({ alreadyNotified: true });
    expect(await sweepSilentVerifiers(now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('records the marker so the next sweep stays quiet', async () => {
    world();
    await sweepSilentVerifiers(now);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const [ownerId, entry] = mockAudit.mock.calls[0];
    expect(ownerId).toBe(OWNER);
    expect((entry as { action: string }).action).toBe(VERIFIER_SILENCE_ACTION);
    expect((entry as { entityId?: string }).entityId).toBe(RELEASE);
  });

  it('leaves out a verifier who has already answered', async () => {
    world({ answered: [{ verifier_id: 'v1' }] });
    await sweepSilentVerifiers(now);
    expect(sent[0].text).not.toContain('Lee');
    expect(sent[0].text).toContain('Sam');
  });

  it('never names somebody the owner revoked', async () => {
    world({
      verifiers: [
        { id: 'v1', name: 'Lee', phone: '+1 555 0100', standby_state: 'revoked' },
        { id: 'v2', name: 'Sam', phone: null, standby_state: 'confirmed' },
      ],
    });
    await sweepSilentVerifiers(now);
    expect(sent[0].text).not.toContain('Lee');
  });

  it('sends nothing when there is nobody left to ring', async () => {
    world({ answered: [{ verifier_id: 'v1' }, { verifier_id: 'v2' }] });
    expect(await sweepSilentVerifiers(now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  /*
    🔴 SEEDED ACCOUNTS ARE EXCLUDED, and this sweep nearly repeated a defect the
    release audit had already closed once. `runHeartbeatSweep` carries
    `is_demo_account = false` with a long comment explaining why: `demo@relay.test`
    is live in production and its contacts sit in reserved domains that CANNOT
    receive mail, so an unattended job mailing them produces hard bounces on a
    Resend account SHARED with report-bridge — where the reputation cost lands on
    a different project entirely.

    Confirmed against production 2026-08-14: `email_delivery_events` holds 18
    rows for `relay.test`, every one of them `delivery_delayed`. This sweep runs
    hourly and unattended, which is exactly the shape the exclusion exists for.
  */
  it('never mails a seeded demo account, whose contacts are in reserved domains', async () => {
    world();
    await sweepSilentVerifiers(now);

    const releaseQuery = mockQuery.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes('FROM release_state'));
    expect(releaseQuery, 'the sweep must not consider demo accounts at all').toMatch(
      /is_demo_account/,
    );
  });

  /*
    Independent owners. One failing lookup must not leave every other family's
    silence unreported — the same rule escalateEach already follows.
  */
  it('keeps going when one release throws', async () => {
    const second = 'cccccccc-3333-4333-8333-cccccccccccc';
    const otherOwner = 'dddddddd-4444-4444-8444-dddddddddddd';
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM release_state'))
        return qResult([
          {
            id: RELEASE,
            owner_id: OWNER,
            trigger_type: 'emergency',
            state: 'pending',
            initiated_at: longAgo,
            received_confirmations: 0,
            required_confirmations: 1,
          },
          {
            id: second,
            owner_id: otherOwner,
            trigger_type: 'travel',
            state: 'pending',
            initiated_at: longAgo,
            received_confirmations: 0,
            required_confirmations: 1,
          },
        ]);
      if (sql.includes('FROM audit_log')) return qResult([]);
      if (sql.includes('FROM verifiers')) {
        // The FIRST owner's roster lookup is broken. The second family's
        // silence must still be reported.
        if ((params as string[])?.includes(OWNER)) throw new Error('DSQL down');
        return qResult([{ id: 'v2', name: 'Sam', phone: '555', standby_state: 'confirmed' }]);
      }
      if (sql.includes('FROM verifier_confirmations')) return qResult([]);
      if (sql.includes('FROM users')) return qResult([{ email: 'owner@example.net' }]);
      return qResult([]);
    });

    expect(await sweepSilentVerifiers(now)).toEqual([second]);
    expect(sent).toHaveLength(1);
  });
});
