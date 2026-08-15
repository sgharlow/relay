/**
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Resend } from 'resend';

import { _setResendClientForTesting } from '../notify/email';
import {
  runFireDrill,
  acknowledgeFireDrill,
  acknowledgePendingDrills,
  fireDrillStatus,
  describeDrill,
  FIRE_DRILL_SENT,
  FIRE_DRILL_ACKNOWLEDGED,
} from './fire-drill';
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

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/** A verifier who is confirmed and holds a passkey — the only class that can act. */
const ableRoster = [
  {
    id: 'v1',
    name: 'Lee',
    email: 'lee@outlook.com',
    email_secondary: 'lee@gmail.com',
    standby_state: 'confirmed',
    claimed_user_id: 'u1',
  },
];

function world(opts: { roster?: unknown[]; passkeys?: unknown[]; audit?: unknown[] } = {}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM verifiers')) return qResult(opts.roster ?? ableRoster);
    if (sql.includes('webauthn_credentials')) return qResult(opts.passkeys ?? [{ user_id: 'u1' }]);
    if (sql.includes('FROM users')) return qResult([{ display_name: 'Margaret' }]);
    if (sql.includes('FROM audit_log')) return qResult(opts.audit ?? []);
    return qResult([]);
  });
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

describe('runFireDrill', () => {
  it('sends the rehearsal to a verifier who can actually answer it', async () => {
    world();
    const out = await runFireDrill(OWNER);

    expect(out.sent.map((p) => p.name)).toEqual(['Lee']);
    expect(sent.length).toBeGreaterThan(0);
  });

  /*
    🔴 THE MESSAGE MUST NOT READ AS AN EMERGENCY. A rehearsal that frightens
    somebody is worse than no rehearsal: it spends the alarm this product needs
    to still work on the real day, and it teaches the circle that a Relay
    message can be ignored. Both facts have to be in the first sentence,
    because that is all a preview pane shows.
  */
  it('says it is practice, and that nothing is happening', async () => {
    world();
    await runFireDrill(OWNER);

    const body = sent[0].text.toLowerCase();
    expect(body).toContain('practice');
    expect(body).toContain('nothing');
    expect(sent[0].subject.toLowerCase()).toMatch(/practice|drill|test/);
  });

  it('carries no code, no token and no sign-in link — a rehearsal is not a credential', async () => {
    world();
    await runFireDrill(OWNER);
    expect(sent[0].text).not.toMatch(/token=/);
    expect(sent[0].text).not.toMatch(/\b\d{5}-\w{5}\b/);
  });

  /*
    Credential-free, so it uses the second address. The drill is the one message
    whose whole purpose is to find out whether somebody can be reached, which
    makes it the message that should try hardest.
  */
  it('reaches the backup address too', async () => {
    world();
    await runFireDrill(OWNER);
    expect(sent.map((m) => m.to)).toEqual(['lee@outlook.com', 'lee@gmail.com']);
  });

  it('records who it was sent to, so silence afterwards is a fact', async () => {
    world();
    await runFireDrill(OWNER);

    const actions = mockAudit.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toContain(FIRE_DRILL_SENT);
  });

  /*
    A verifier with no passkey and no authenticator cannot sign in, so the only
    way to let them acknowledge would be to mail them a working credential — for
    a rehearsal. That trade is obviously wrong, and their inability IS the
    finding: it goes back to the owner as a named gap rather than as an email
    the person cannot act on.
  */
  it('does not mail somebody who would need a credential to answer', async () => {
    world({ passkeys: [] });
    const out = await runFireDrill(OWNER);

    expect(sent).toHaveLength(0);
    expect(out.sent).toEqual([]);
    expect(out.cannotAnswer.map((p) => p.name)).toEqual(['Lee']);
  });

  it('never mails a revoked verifier', async () => {
    world({ roster: [{ ...ableRoster[0], standby_state: 'revoked' }] });
    const out = await runFireDrill(OWNER);
    expect(sent).toHaveLength(0);
    expect(out.sent).toEqual([]);
  });

  it('reports an unconfirmed verifier as unable rather than mailing them', async () => {
    world({ roster: [{ ...ableRoster[0], standby_state: 'claimed' }] });
    const out = await runFireDrill(OWNER);
    expect(sent).toHaveLength(0);
    expect(out.cannotAnswer.map((p) => p.name)).toEqual(['Lee']);
  });
});

describe('acknowledgeFireDrill', () => {
  it('records the acknowledgement against the verifier', async () => {
    world();
    await acknowledgeFireDrill({ ownerId: OWNER, verifierId: 'v1' });

    const [ownerId, entry] = mockAudit.mock.calls[0];
    expect(ownerId).toBe(OWNER);
    expect((entry as { action: string }).action).toBe(FIRE_DRILL_ACKNOWLEDGED);
    expect((entry as { entityId?: string }).entityId).toBe('v1');
    expect((entry as { actor: string }).actor).toBe('verifier:v1');
  });
});

describe('acknowledgePendingDrills', () => {
  function asVerifier(rows: unknown[], audit: unknown[] = []) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM verifiers')) return qResult(rows);
      if (sql.includes('FROM audit_log')) return qResult(audit);
      return qResult([]);
    });
  }

  it('answers on behalf of every owner who is waiting to hear from this person', async () => {
    asVerifier(
      [
        { id: 'v1', owner_id: OWNER, standby_state: 'confirmed' },
        { id: 'v9', owner_id: 'other-owner', standby_state: 'confirmed' },
      ],
      [
        { entity_id: 'v1', action: FIRE_DRILL_SENT, ts: '2026-08-14T09:00:00.000Z' },
        { entity_id: 'v9', action: FIRE_DRILL_SENT, ts: '2026-08-14T09:00:00.000Z' },
      ],
    );

    expect(await acknowledgePendingDrills('u1')).toBe(2);
    expect(mockAudit).toHaveBeenCalledTimes(2);
  });

  /*
    An acknowledgement with no drill behind it is a green light nobody asked
    for. It would put "answered the last practice run" on the owner's screen on
    the strength of somebody opening a page.
  */
  it('records nothing when no drill is waiting', async () => {
    asVerifier([{ id: 'v1', owner_id: OWNER, standby_state: 'confirmed' }], []);
    expect(await acknowledgePendingDrills('u1')).toBe(0);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('does not answer twice for the same drill', async () => {
    asVerifier(
      [{ id: 'v1', owner_id: OWNER, standby_state: 'confirmed' }],
      [
        { entity_id: 'v1', action: FIRE_DRILL_SENT, ts: '2026-08-14T09:00:00.000Z' },
        { entity_id: 'v1', action: FIRE_DRILL_ACKNOWLEDGED, ts: '2026-08-14T09:02:00.000Z' },
      ],
    );
    expect(await acknowledgePendingDrills('u1')).toBe(0);
  });

  /*
    Filtered in SQL rather than in JS, matching standby-resolve.ts: "a withdrawn
    person cannot be resurrected by a rendering bug". A mock cannot exercise a
    WHERE clause, so the guard itself is what gets asserted — the alternative is
    a test that passes because the fixture happened to be filtered by hand.
  */
  it('never looks at a place the owner has revoked them from', async () => {
    asVerifier([], []);
    await acknowledgePendingDrills('u1');

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('claimed_user_id');
    expect(sql).toMatch(/standby_state.*<>\s*'revoked'/s);
  });
});

describe('fireDrillStatus', () => {
  it('pairs each send with its acknowledgement', async () => {
    world({
      audit: [
        { entity_id: 'v1', action: FIRE_DRILL_SENT, ts: '2026-08-14T09:00:00.000Z' },
        { entity_id: 'v1', action: FIRE_DRILL_ACKNOWLEDGED, ts: '2026-08-14T09:04:00.000Z' },
        { entity_id: 'v2', action: FIRE_DRILL_SENT, ts: '2026-08-14T09:00:00.000Z' },
      ],
    });

    const status = await fireDrillStatus(OWNER);
    expect(status.get('v1')?.acknowledgedAt).toBe('2026-08-14T09:04:00.000Z');
    expect(status.get('v2')?.acknowledgedAt).toBeNull();
    expect(status.get('v2')?.sentAt).toBe('2026-08-14T09:00:00.000Z');
  });

  it('keeps the LATEST of each, so an old drill cannot vouch for a new one', async () => {
    world({
      audit: [
        { entity_id: 'v1', action: FIRE_DRILL_SENT, ts: '2026-08-01T09:00:00.000Z' },
        { entity_id: 'v1', action: FIRE_DRILL_ACKNOWLEDGED, ts: '2026-08-01T09:05:00.000Z' },
        { entity_id: 'v1', action: FIRE_DRILL_SENT, ts: '2026-08-14T09:00:00.000Z' },
      ],
    });

    const status = await fireDrillStatus(OWNER);
    expect(status.get('v1')?.sentAt).toBe('2026-08-14T09:00:00.000Z');
    expect(status.get('v1')?.acknowledgedAt).toBe('2026-08-01T09:05:00.000Z');
  });
});

describe('describeDrill', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');

  it('says nothing when no drill has ever been run for this person', () => {
    expect(describeDrill('Lee', null, now)).toBeNull();
  });

  it('reports a confirmed rehearsal quietly', () => {
    const line = describeDrill(
      'Lee',
      { sentAt: '2026-08-14T09:00:00.000Z', acknowledgedAt: '2026-08-14T09:04:00.000Z' },
      now,
    );
    expect(line!.tone).toBe('note');
    expect(line!.text.toLowerCase()).toContain('answered');
  });

  /*
    🔴 THE ONLY REASON THE DRILL EXISTS. An unanswered rehearsal is the product
    finally being able to say "this person could not be reached" BEFORE the day
    it matters — and it must not be soft about it, because the owner's instinct
    will be to assume the person is simply busy.
  */
  it('is loud about a rehearsal nobody answered', () => {
    const line = describeDrill(
      'Lee',
      { sentAt: '2026-08-13T09:00:00.000Z', acknowledgedAt: null },
      now,
    );
    expect(line!.tone).toBe('warn');
    expect(line!.text.toLowerCase()).toContain('did not answer');
  });

  it('does not call a fresh drill a failure — nobody answers within a minute', () => {
    const line = describeDrill(
      'Lee',
      { sentAt: '2026-08-14T11:59:00.000Z', acknowledgedAt: null },
      now,
    );
    expect(line!.tone).toBe('note');
  });

  it('does not let a stale acknowledgement vouch for the newest drill', () => {
    const line = describeDrill(
      'Lee',
      { sentAt: '2026-08-13T09:00:00.000Z', acknowledgedAt: '2026-08-01T09:00:00.000Z' },
      now,
    );
    expect(line!.tone).toBe('warn');
  });
});
