/**
 * The second address, where it actually has to work: the release path.
 *
 * `addressesFor` holds the rule; these tests hold the WIRING — that the rule is
 * consulted at the two send sites whose silence stops a release, with the real
 * notice bodies, and that the credential-carrying branches were not fanned out
 * by accident. A pure-function test of the rule would have passed all day while
 * the column stayed unread, which is the state this feature started in.
 *
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Resend } from 'resend';

import { _setResendClientForTesting } from './email';
import { notifyOneVerifier, notifyRecipientsOfRelease } from './notifications';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);

const sent: Array<{ to: string; subject: string; text: string }> = [];

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

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

const ctx = {
  triggerType: 'emergency',
  releaseStateId: '11111111-1111-4111-8111-111111111111',
  ownerId: '22222222-2222-4222-8222-222222222222',
  ownerLabel: 'Margaret',
  caseId: 'RLY-TEST',
};

beforeEach(() => {
  sent.length = 0;
  mockQuery.mockReset();
  mockQuery.mockImplementation(async () => qResult([]));
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.VERIFIER_JWT_SECRET = 'test-secret';
  process.env.RECIPIENT_JWT_SECRET = 'test-recipient-secret';
  process.env.NEXTAUTH_URL = 'https://relay.test';
  _setResendClientForTesting(stubResend());
});
afterEach(() => _setResendClientForTesting(null));

const verifier = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Lee',
  email: 'lee@outlook.com',
  email_secondary: 'lee@gmail.com',
};

describe('a verifier notice that carries no credential reaches both addresses', () => {
  it('sign_in — the message says "go and sign in" and holds nothing worth intercepting', async () => {
    await notifyOneVerifier(verifier, { ...ctx, noticeClass: 'sign_in' });

    expect(sent.map((m) => m.to)).toEqual(['lee@outlook.com', 'lee@gmail.com']);
    // Both copies are the same message, not a summary and a stub.
    expect(sent[0].text).toBe(sent[1].text);
    expect(sent[0].subject).toBe(sent[1].subject);
  });

  it('not_counted — being told you were named is worth nothing to a thief', async () => {
    await notifyOneVerifier(verifier, { ...ctx, noticeClass: 'not_counted' });
    expect(sent.map((m) => m.to)).toEqual(['lee@outlook.com', 'lee@gmail.com']);
  });

  it('counts the person once, not the sends — the caller is counting people', async () => {
    const ok = await notifyOneVerifier(verifier, { ...ctx, noticeClass: 'sign_in' });
    expect(ok).toBe(true);
  });
});

describe('🔴 a verifier notice that carries a credential goes to ONE address', () => {
  /*
    The `code` class mints a single-use verifier code and puts it in the body.
    Fanning that out would double the number of mailboxes a live credential sits
    in, to buy reachability — trading away the exact property (nothing secret in
    transit) that adaptive minting was built to protect. `sign_in` above is the
    branch redundancy is FOR.
  */
  it('does not copy a minted code to the backup mailbox', async () => {
    await notifyOneVerifier(verifier, { ...ctx, noticeClass: 'code' });

    expect(sent.map((m) => m.to)).toEqual(['lee@outlook.com']);
    expect(sent).toHaveLength(1);
  });

  it('does not copy the legacy token link either, when code minting fails', async () => {
    // No ownerId → no code is minted and the body falls back to /verify?token=.
    // That link is a credential in a URL; one copy of it is already the
    // deliberate last resort.
    await notifyOneVerifier(verifier, { ...ctx, ownerId: undefined, noticeClass: 'code' });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('lee@outlook.com');
    expect(sent[0].text).toContain('/verify?token=');
  });

  it('sends nothing at all to a revoked verifier, on either address', async () => {
    await notifyOneVerifier(verifier, { ...ctx, noticeClass: 'skip' });
    expect(sent).toHaveLength(0);
  });
});

/*
  🔴 READS SOURCE, because this is the failure that actually happened. Three
  separate call sites loaded the roster and then rebuilt the contact by hand as
  `{ id, name, email }` — so a verifier's second address existed in the
  database, was selected by `listVerifiers`, and was thrown away one line before
  the send. Nothing would have failed; the feature would simply never have
  fired on the release path, which is the only path it exists for.

  A behavioural test proves the site it happens to exercise. This fails when
  somebody adds a FOURTH caller and hand-rolls it, which is the thing that will
  actually happen.
*/
describe('every caller passes the whole contact, not a hand-picked subset', () => {
  const strip = (p: string) =>
    readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');

  const callers = [
    'lib/release/escalation.ts',
    'lib/release/heartbeat.ts',
    'src/app/api/triggers/[id]/initiate/route.ts',
  ];

  it.each(callers)('%s uses the shared mapper', (p) => {
    expect(strip(p)).toContain('toVerifierContact');
  });

  it.each(callers)('%s does not rebuild the contact inline', (p) => {
    expect(strip(p), 'a hand-built contact silently drops email_secondary').not.toMatch(
      /name:\s*v\.name,\s*email:\s*v\.email/,
    );
  });
});

describe('the recipient release notice', () => {
  function rosterOf(row: Record<string, unknown>) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM recipients')) return qResult([row]);
      if (sql.includes('FROM users')) return qResult([{ display_name: 'Margaret' }]);
      return qResult([]);
    });
  }

  it('reaches both addresses for a CLAIMED recipient — that message has no code in it', async () => {
    rosterOf({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Sarah',
      email: 'sarah@outlook.com',
      email_secondary: 'sarah@gmail.com',
      claimed_user_id: '55555555-5555-4555-8555-555555555555',
    });

    await notifyRecipientsOfRelease({
      releaseStateId: ctx.releaseStateId,
      ownerId: ctx.ownerId,
      triggerType: 'emergency',
      version: 1,
    });

    expect(sent.map((m) => m.to)).toEqual(['sarah@outlook.com', 'sarah@gmail.com']);
    expect(sent[0].text).not.toMatch(/token=/);
  });

  it('does NOT fan out to an unclaimed recipient, whose message carries their code', async () => {
    rosterOf({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Sarah',
      email: 'sarah@outlook.com',
      email_secondary: 'sarah@gmail.com',
      claimed_user_id: null,
    });

    await notifyRecipientsOfRelease({
      releaseStateId: ctx.releaseStateId,
      ownerId: ctx.ownerId,
      triggerType: 'emergency',
      version: 1,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('sarah@outlook.com');
  });

  it('reads the column at all — the defect this feature started as', async () => {
    rosterOf({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Sarah',
      email: 'sarah@outlook.com',
      email_secondary: 'sarah@gmail.com',
      claimed_user_id: '55555555-5555-4555-8555-555555555555',
    });

    await notifyRecipientsOfRelease({
      releaseStateId: ctx.releaseStateId,
      ownerId: ctx.ownerId,
      triggerType: 'emergency',
      version: 1,
    });

    const roster = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes('FROM recipients'));
    expect(roster, 'the roster query must select the second address').toContain('email_secondary');
  });
});
