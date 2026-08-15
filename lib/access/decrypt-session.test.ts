/**
 * Tests for decrypt on the SESSION path — hybrid+6's primary route.
 *
 * THE DEFECT THIS CLOSES, found by the 2026-08-12 beta reassessment: sprint D
 * swapped the recipient READ path to sessions, so `/api/access` resolved a
 * release plan for a claimed recipient with no token. Reveal was never swapped.
 * It posted `{ token: '' }`, the route demanded a recipient JWT, and every
 * decrypt took a 401 — a dashboard that listed everything and opened nothing.
 * J8, the journey carrying primary demand, did not work on the architecture
 * built to replace the token.
 *
 * The decision recorded here: the route accepts a session rather than minting a
 * short-lived token. Minting one would put a bearer credential back in the
 * browser — the exact thing hybrid+6 removes — and restore the staleness window
 * that a session does not have.
 *
 * WHAT MUST NOT DIFFER between the two routes is everything after the door:
 * released-only, Property 6 scope, audit before KMS. That is what these assert.
 *
 * Feature: relay-standby
 * Requirements: 7.5, 7.8, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));
vi.mock('../kms/kms-client', () => ({ decryptDataKey: vi.fn(async () => 'PLAINTEXT_KEY_B64') }));
vi.mock('./session-access', () => ({
  resolveReleaseForUser: vi.fn(),
  resolveReleasesForUser: vi.fn(),
}));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { decryptDataKey } from '../kms/kms-client';
import { resolveReleaseForUser, resolveReleasesForUser } from './session-access';
import { decryptAccessItemForUser, AccessError } from './dashboard';

const mockQuery = vi.mocked(query);
const mockResolve = vi.mocked(resolveReleaseForUser);
const mockResolveAll = vi.mocked(resolveReleasesForUser);

/**
 * The decrypt path resolves EVERY open release now, then picks the one whose
 * access rule covers the item — a contact standing by for two owners could
 * otherwise see the second owner's plan and open nothing on it.
 *
 * These tests were written against the singular resolver, so this keeps them
 * driving the same fixture: `resolved()` in, one release out.
 */
function stubSingle(r: ReturnType<typeof resolved> | null) {
  mockResolve.mockResolvedValue(r as never);
  mockResolveAll.mockResolvedValue((r ? [r] : []) as never);
}
const mockKms = vi.mocked(decryptDataKey);
const mockAudit = vi.mocked(writeAuditEntry);

const USER = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const RELEASE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

function resolved(overrides: Record<string, unknown> = {}) {
  return {
    recipientId: RECIPIENT,
    ownerId: OWNER,
    releaseStateId: RELEASE,
    triggerType: 'emergency',
    state: 'released',
    released: true,
    ...overrides,
  };
}

/**
 * The three reads decryptForPrincipal makes, in order: the release row, the
 * access rule, then the item.
 */
function wireDb(opts: { state?: string; version?: string; rule?: boolean; item?: boolean } = {}) {
  const { state = 'released', version = '7', rule = true, item = true } = opts;
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: RELEASE, owner_id: OWNER, state, version, trigger_type: 'emergency' }],
      rowCount: 1,
    } as never)
    .mockResolvedValueOnce({
      rows: rule ? [{ id: 'rule-1' }] : [],
      rowCount: rule ? 1 : 0,
    } as never)
    .mockResolvedValueOnce({
      rows: item
        ? [{ ciphertext: Buffer.from('ct'), wrapped_data_key: Buffer.from('wk'), kms_key_id: 'k1' }]
        : [],
      rowCount: item ? 1 : 0,
    } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockResolve.mockReset();
  mockResolveAll.mockReset();
  mockKms.mockReset().mockResolvedValue('PLAINTEXT_KEY_B64');
  mockAudit.mockReset().mockResolvedValue({} as never);
});

describe('decryptAccessItemForUser', () => {
  it('opens an item for a signed-in claimed recipient, with no token anywhere', async () => {
    stubSingle(resolved());
    wireDb();

    const out = await decryptAccessItemForUser(USER, ITEM);

    expect(out.plaintext_data_key).toBe('PLAINTEXT_KEY_B64');
    expect(out.kms_key_id).toBe('k1');
  });

  it('resolves membership from the database, not from the session token', async () => {
    // §3.7 rule 1. The JWT says who you are; only the row says what you may open.
    // Asserted against the PLURAL resolver: the path now reads every open
    // release for this user and picks by the item, so this is where the
    // database read that establishes membership happens.
    stubSingle(resolved());
    wireDb();

    await decryptAccessItemForUser(USER, ITEM);

    expect(mockResolveAll).toHaveBeenCalledWith(USER);
  });

  it('refuses a user who is nobody’s claimed recipient', async () => {
    stubSingle(null);

    await expect(decryptAccessItemForUser(USER, ITEM)).rejects.toBeInstanceOf(AccessError);
    expect(mockKms).not.toHaveBeenCalled();
  });

  it('gives the same answer for "not a recipient" as for "out of scope"', async () => {
    // Distinguishable messages would tell an attacker which of the two is true.
    const failure = async (): Promise<AccessError> => {
      try {
        await decryptAccessItemForUser(USER, ITEM);
        throw new Error('expected a refusal');
      } catch (e) {
        return e as AccessError;
      }
    };

    stubSingle(null);
    const notRecipient = await failure();

    stubSingle(resolved());
    wireDb({ rule: false });
    const outOfScope = await failure();

    expect(notRecipient.message).toBe(outOfScope.message);
    expect(notRecipient.httpStatus).toBe(outOfScope.httpStatus);
  });

  it('refuses an item outside the access rules — Property 6 holds on this path too', async () => {
    stubSingle(resolved());
    wireDb({ rule: false });

    await expect(decryptAccessItemForUser(USER, ITEM)).rejects.toBeInstanceOf(AccessError);
    expect(mockKms).not.toHaveBeenCalled();
  });

  it('refuses when the release is not RELEASED — a re-arm closes access at once', async () => {
    // The session carries no version, so this is the check that makes standing
    // down effective: the row is read on this request and it says armed.
    stubSingle(resolved({ state: 'armed', released: false }));
    wireDb({ state: 'armed' });

    await expect(decryptAccessItemForUser(USER, ITEM)).rejects.toThrow(/not active/i);
    expect(mockKms).not.toHaveBeenCalled();
  });

  it('never calls KMS before the gates pass, and audits the denial', async () => {
    stubSingle(resolved());
    wireDb({ rule: false });

    await decryptAccessItemForUser(USER, ITEM).catch(() => undefined);

    expect(mockKms).not.toHaveBeenCalled();
    const actions = mockAudit.mock.calls.map((c) => (c[1] as { detail?: { outcome?: string } }).detail?.outcome);
    expect(actions).toContain('denied');
  });

  it('audits an authorized decrypt against the owner', async () => {
    stubSingle(resolved());
    wireDb();

    await decryptAccessItemForUser(USER, ITEM);

    const [ownerId, entry] = mockAudit.mock.calls[0] as [string, { action: string; actor: string }];
    expect(ownerId).toBe(OWNER);
    expect(entry.action).toBe('vault_item_decrypted');
    // The recipient row is the actor, not the user id — the owner's audit chain
    // reads in terms of the people they named.
    expect(entry.actor).toBe(`recipient:${RECIPIENT}`);
  });
});

/**
 * Standing by for two people at once.
 *
 * 🔴 THE DASHBOARD WOULD HAVE LISTED ITEMS THAT EVERY REVEAL REFUSED. Once
 * /api/access learned to offer both owners, this path still resolved whichever
 * release sorted first and looked for the item under THAT recipient — so
 * choosing the second parent produced a plan where nothing opened.
 *
 * The release is chosen BY THE ITEM, from the access rule, rather than by a
 * parameter the client sends: the rule already knows the answer authoritatively,
 * and a client-supplied owner would be an input to validate.
 */
describe('decryptAccessItemForUser — two owners open at once', () => {
  const OTHER_RECIPIENT = '66666666-6666-4666-8666-666666666666';
  const OTHER_RELEASE = '77777777-7777-4777-8777-777777777777';
  const OTHER_OWNER = '88888888-8888-4888-8888-888888888888';

  const second = () =>
    resolved({
      recipientId: OTHER_RECIPIENT,
      ownerId: OTHER_OWNER,
      releaseStateId: OTHER_RELEASE,
    });

  it('opens an item scoped to the SECOND owner, not the first that sorted', async () => {
    mockResolveAll.mockResolvedValue([resolved(), second()] as never);
    mockQuery.mockReset();
    // The coverage lookup: only the second owner's recipient has a rule.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ recipient_id: OTHER_RECIPIENT }], rowCount: 1 } as never)
      // Then the ordinary three reads, against the SECOND release.
      .mockResolvedValueOnce({
        rows: [
          { id: OTHER_RELEASE, owner_id: OTHER_OWNER, state: 'released', version: '3', trigger_type: 'emergency' },
        ],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'rule-2' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{ ciphertext: 'CT', wrapped_data_key: 'WK', kms_key_id: 'key-1' }],
        rowCount: 1,
      } as never);

    await decryptAccessItemForUser(USER, ITEM);

    // Audited against the owner whose item it actually was.
    const [ownerId, entry] = mockAudit.mock.calls[0] as [string, { actor: string }];
    expect(ownerId).toBe(OTHER_OWNER);
    expect(entry.actor).toBe(`recipient:${OTHER_RECIPIENT}`);
  });

  /*
    The obvious implementation — try each release through decryptForPrincipal
    until one works — would write a `denied` entry into every owner's chain it
    tried. One recipient opening one item would leave a denial in a second
    family's tamper-evident log. An audit chain that records things that did not
    happen is worse than one that misses things.
  */
  it('leaves no denial in the other family’s audit chain', async () => {
    mockResolveAll.mockResolvedValue([resolved(), second()] as never);
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ recipient_id: OTHER_RECIPIENT }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [
          { id: OTHER_RELEASE, owner_id: OTHER_OWNER, state: 'released', version: '3', trigger_type: 'emergency' },
        ],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'rule-2' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{ ciphertext: 'CT', wrapped_data_key: 'WK', kms_key_id: 'key-1' }],
        rowCount: 1,
      } as never);

    await decryptAccessItemForUser(USER, ITEM);

    const owners = mockAudit.mock.calls.map((c) => c[0]);
    expect(owners).not.toContain(OWNER);
  });

  it('skips the coverage lookup entirely when only one release is open', async () => {
    stubSingle(resolved());
    wireDb();

    await decryptAccessItemForUser(USER, ITEM);

    // wireDb queues exactly the three reads decryptForPrincipal makes. A fourth
    // would mean the coverage lookup ran for no reason.
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('still refuses when no open release covers the item', async () => {
    mockResolveAll.mockResolvedValue([resolved(), second()] as never);
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // nothing covers it
      .mockResolvedValueOnce({
        rows: [{ id: RELEASE, owner_id: OWNER, state: 'released', version: '7', trigger_type: 'emergency' }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // no rule

    await expect(decryptAccessItemForUser(USER, ITEM)).rejects.toBeInstanceOf(AccessError);
    expect(mockKms).not.toHaveBeenCalled();
  });
});
