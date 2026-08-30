/**
 * "What happened while you were away" (§8.2).
 *
 * This handler executed no test until 2026-08-30.
 *
 * 🔴 METADATA ONLY, AND THE LINE IS FINER HERE THAN ELSEWHERE (CC2). This route
 * legitimately reads item TITLES — the whole point is to say what was opened,
 * and a title is the least that can mean. That makes it the one incident surface
 * where a widened SELECT would look defensible, so the boundary is asserted
 * against the SQL: titles yes, ciphertext and the wrapped key never.
 *
 * 🔴 IT IS DERIVED ON EVERY READ, NOT STORED. `buildIncidents` runs over the
 * append-only log each time, so the summary cannot drift from the record it
 * summarises. A cached or materialised version would be a second source of
 * truth about what happened to somebody's vault.
 *
 * 🔴 THE LOG IS READ IN SEQUENCE ORDER. The chain is hash-linked per owner, and
 * `buildIncidents` folds entries in order; reading them unordered would produce a
 * plausible-looking and wrong narrative.
 *
 * Feature: relay-standby
 * Requirements: 8.6, J9-R4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/audit/incident-record', () => ({
  buildIncidents: vi.fn(() => []),
  describeIncident: vi.fn(() => 'a sentence'),
}));

import { requireOwner } from '../../../../../lib/http/owner-route';
import { query } from '../../../../../lib/db/connection';
import { buildIncidents, describeIncident } from '../../../../../lib/audit/incident-record';
import { GET } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockQuery = vi.mocked(query);
const mockBuild = vi.mocked(buildIncidents);
const mockDescribe = vi.mocked(describeIncident);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const ITEM = '11111111-2222-4333-8444-555566667777';
const REC = 'aaaaaaaa-2222-4333-8444-555566667777';
const VER = 'bbbbbbbb-2222-4333-8444-555566667777';

let fixture: Record<string, Record<string, unknown>[]>;

function routeQuery(sql: unknown): { rows: Record<string, unknown>[] } {
  const s = String(sql);
  if (/FROM audit_log/.test(s)) return { rows: fixture.audit_log };
  if (/FROM vault_items/.test(s)) return { rows: fixture.vault_items };
  if (/FROM recipients/.test(s)) return { rows: fixture.recipients };
  if (/FROM verifiers/.test(s)) return { rows: fixture.verifiers };
  throw new Error('unexpected query: ' + s);
}

function sqlFor(re: RegExp): string {
  const call = mockQuery.mock.calls.find((c) => re.test(String(c[0])));
  if (!call) throw new Error('no query matched ' + re);
  return String(call[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = {
    audit_log: [{ seq: 1, actor: 'recipient:' + REC, action: 'item_revealed', entity_id: ITEM, detail: null, ts: 'now' }],
    vault_items: [{ id: ITEM, title: 'Primary email' }],
    recipients: [{ id: REC, name: 'April' }],
    verifiers: [{ id: VER, name: 'Ben' }],
  };
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockQuery.mockImplementation(async (sql: unknown) => routeQuery(sql) as never);
  mockBuild.mockReturnValue([{ kind: 'reveal', itemId: ITEM }] as never);
  mockDescribe.mockReturnValue('April opened Primary email');
});

describe('the zero-knowledge boundary (CC2)', () => {
  it('reads titles but never ciphertext or the wrapped key', async () => {
    await GET();
    const sql = sqlFor(/FROM vault_items/);
    expect(sql).toMatch(/title/);
    expect(sql).not.toMatch(/ciphertext/i);
    expect(sql).not.toMatch(/wrapped_data_key/i);
    expect(sql).not.toMatch(/kms_key_id/i);
  });

  it('scopes every read to the session owner', async () => {
    await GET();
    for (const [, params] of mockQuery.mock.calls) expect(params).toEqual([OWNER]);
  });
});

describe('deriving the narrative', () => {
  it('reads the log in sequence order', async () => {
    // The chain is ordered; folding it unordered produces a plausible and wrong
    // account of what happened.
    await GET();
    expect(sqlFor(/FROM audit_log/)).toMatch(/ORDER BY seq ASC/);
  });

  it('builds from the entries, with titles and names resolved', async () => {
    await GET();
    const [entries, maps] = mockBuild.mock.calls[0];
    expect(entries).toEqual(fixture.audit_log);
    expect((maps as { itemTitles: Map<string, string> }).itemTitles.get(ITEM)).toBe('Primary email');
  });

  it('resolves recipients and verifiers into one name map', async () => {
    await GET();
    const maps = mockBuild.mock.calls[0][1] as { personNames: Map<string, string> };
    expect(maps.personNames.get(REC)).toBe('April');
    expect(maps.personNames.get(VER)).toBe('Ben');
  });

  it('attaches a summary sentence to each incident', async () => {
    const body = await (await GET()).json();
    expect(body.incidents).toEqual([
      { kind: 'reveal', itemId: ITEM, summary: 'April opened Primary email' },
    ]);
    expect(mockDescribe).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list for a quiet vault', async () => {
    mockBuild.mockReturnValueOnce([]);
    expect(await (await GET()).json()).toEqual({ incidents: [] });
  });
});

describe('what it refuses', () => {
  it('refuses without a session and reads nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
  });
});
