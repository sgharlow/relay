/**
 * A release opened and nobody could be told.
 *
 * 🔴 THE GAP. Both release paths call `notifyRecipientsOfRelease` and discard
 * what it returns — `runHeartbeatSweep` with `.catch(() => undefined)`, the
 * quorum path with `.catch(() => {})`. That is right as far as it goes: a mail
 * failure must never roll back a committed transition. But it meant the count of
 * people actually reached was computed and thrown away, so the one outcome this
 * product exists to prevent left no trace anywhere: `release_state` says
 * `released`, nobody was notified, and `/circle` shows `unknown` — which means
 * "we have not heard", not "fine".
 *
 * `sweepSilentVerifiers` does not cover it; that watches releases WAITING on
 * confirmations. The before-state was watched and the after-state was not.
 *
 * THE THREE STATES ARE THE WHOLE TEST. `0 reached` is ambiguous on its own, and
 * getting that wrong in either direction is the failure mode: report too little
 * and the catastrophic case stays invisible; report too much and the channel
 * fires on every demo account with an unscoped trigger and gets muted, which
 * this repo has written down as how monitors die.
 *
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Resend } from 'resend';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../ops/error-reporter', () => ({ reportServerError: vi.fn(async () => undefined) }));

import { _setResendClientForTesting } from './email';
import { notifyRecipientsOfRelease, RELEASE_NOTICE_UNDELIVERED_ACTION } from './notifications';
import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { reportServerError } from '../ops/error-reporter';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);
const mockAlert = vi.mocked(reportServerError);

const OWNER = '22222222-2222-4222-8222-222222222222';
const RELEASE = '11111111-1111-4111-8111-111111111111';

const qResult = (rows: unknown[]) =>
  ({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }) as never;

/** A claimed recipient: the branch that mints no credential, so nothing else fails first. */
const claimed = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `Rec ${i}`,
    email: `rec${i}@example.org`,
    email_secondary: null,
    claimed_user_id: `user-${i}`,
  }));

/**
 * `notifyRecipientsOfRelease` issues the recipient SELECT first, then
 * `getOwnerLabel`. Everything after the first call returns empty.
 */
function withRecipients(rows: unknown[]) {
  mockQuery.mockReset();
  let call = 0;
  mockQuery.mockImplementation(async () => {
    call += 1;
    return call === 1 ? qResult(rows) : qResult([]);
  });
}

function resend(opts: { accept: boolean }): Resend {
  return {
    emails: {
      send: vi.fn(async () =>
        opts.accept
          ? { data: { id: 'mail-1' }, error: null }
          : { data: null, error: { name: 'bounced', message: 'no such mailbox' } },
      ),
    },
  } as unknown as Resend;
}

beforeEach(() => {
  mockAudit.mockClear();
  mockAlert.mockClear();
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.NEXTAUTH_URL = 'https://relay.test';
});
afterEach(() => _setResendClientForTesting(null));

const release = {
  releaseStateId: RELEASE,
  ownerId: OWNER,
  triggerType: 'emergency',
  version: '3',
};

describe('a release nobody could be told about', () => {
  /*
    THE CASE THE WHOLE THING EXISTS FOR. Recipients were scoped, the release
    opened, and every send was refused by the provider.
  */
  it('records it durably AND tells a human when recipients existed and none was reached', async () => {
    withRecipients(claimed(2));
    _setResendClientForTesting(resend({ accept: false }));

    const reached = await notifyRecipientsOfRelease(release);

    expect(reached).toBe(0);

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const [ownerId, entry] = mockAudit.mock.calls[0];
    expect(ownerId).toBe(OWNER);
    expect(entry.action).toBe(RELEASE_NOTICE_UNDELIVERED_ACTION);
    expect(entry.entityId).toBe(RELEASE);
    expect(entry.detail).toMatchObject({ recipientCount: 2, reached: 0 });

    // Durable is not the same as noticed. In the emergency case the owner is by
    // hypothesis the person who cannot go and read their own audit trail.
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(String(mockAlert.mock.calls[0][0])).toMatch(/opened but NONE/i);
  });

  /*
    ⚠️ THE LINE BETWEEN A SIGNAL AND NOISE. A release with nobody scoped to the
    trigger also reaches zero people, and it is not a delivery failure — it is a
    configuration fact. Alarming on it would fire on every account with an
    unscoped trigger, and a channel that cries wolf gets muted, which is worse
    than no channel because it still looks like coverage.
  */
  it('says NOTHING when there were no recipients to reach in the first place', async () => {
    withRecipients([]);
    _setResendClientForTesting(resend({ accept: false }));

    const reached = await notifyRecipientsOfRelease(release);

    expect(reached).toBe(0);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('says nothing on the ordinary path where everyone was reached', async () => {
    withRecipients(claimed(2));
    _setResendClientForTesting(resend({ accept: true }));

    const reached = await notifyRecipientsOfRelease(release);

    expect(reached).toBe(2);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  /*
    PARTIAL SUCCESS IS SUCCESS, and deliberately silent. The whole point of a
    second address, and of several recipients, is that one path failing is
    survivable — somebody was reached, so the release is not silent. Reporting
    here would put an emergency in front of an operator about a message that
    did arrive.
  */
  it('says nothing when one of several recipients was reached', async () => {
    withRecipients(claimed(2));
    let n = 0;
    _setResendClientForTesting({
      emails: {
        send: vi.fn(async () => {
          n += 1;
          return n === 1
            ? { data: { id: 'mail-1' }, error: null }
            : { data: null, error: { name: 'bounced', message: 'no' } };
        }),
      },
    } as unknown as Resend);

    const reached = await notifyRecipientsOfRelease(release);

    expect(reached).toBe(1);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  /*
    THE RELEASE IS ALREADY COMMITTED WHEN THIS RUNS. An exception escaping here
    would propagate into the release path, where both callers' `.catch()` would
    swallow it — turning a recorded delivery failure into an unrecorded one, and
    achieving the exact opposite of the point.
  */
  it('never throws, even when both recording channels fail', async () => {
    withRecipients(claimed(1));
    _setResendClientForTesting(resend({ accept: false }));
    mockAudit.mockRejectedValueOnce(new Error('DSQL unavailable'));
    mockAlert.mockRejectedValueOnce(new Error('resend down'));

    await expect(notifyRecipientsOfRelease(release)).resolves.toBe(0);
  });
});
