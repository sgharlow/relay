/**
 * Tests for POST /api/import
 *
 * Validates: Requirements 10.4, 10.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/vault/vault-items', async (io) => {
  const actual = await io<typeof import('../../../../lib/vault/vault-items')>();
  return { ...actual, createItem: vi.fn() };
});
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
// Import now reads the vault to skip duplicates, and re-scores what arrives —
// without that scoring an imported vault sat at a flat importance with no
// dependency graph, so the caregiver who gave us the most data got the least.
vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }));
vi.mock('../../../../lib/ai/intake-agent', () => ({ runIntake: vi.fn(async () => ({})) }));
vi.mock('../../../../lib/rules/policy-materialize', () => ({
  coverNewItem: vi.fn(async () => ({ policiesMatched: 0 })),
}));

import { getOwnerSession } from '../../../../lib/auth/session';
import { createItem } from '../../../../lib/vault/vault-items';
import { runIntake } from '../../../../lib/ai/intake-agent';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockCreate = vi.mocked(createItem);
const mockIntake = vi.mocked(runIntake);

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}
const VALID_B64 = 'AAAA';
function item(over: Record<string, unknown> = {}) {
  // secret_kinds is derived per row by encryptForUpload in the import client and
  // required at the boundary since 035 Phase 1 was hardened — an imported login
  // holds a password, and may hold a TOTP the CSV carried.
  return { type: 'login', title: 'Gmail', ciphertext: VALID_B64, wrapped_data_key: VALID_B64, kms_key_id: 'cmk', secret_kinds: 'password', ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
  mockCreate.mockResolvedValue({ id: 'new' } as never);
});

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await POST(makeReq({ items: [item()] }));
  expect(res.status).toBe(401);
});

it('imports a batch and returns the count', async () => {
  const res = await POST(makeReq({ items: [item({ title: 'A' }), item({ title: 'B' })] }));
  expect(res.status).toBe(200);
  expect((await res.json()).imported).toBe(2);
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

it('rejects the WHOLE batch (400) with nothing inserted if any item is invalid (Req 10.4)', async () => {
  const res = await POST(makeReq({ items: [item(), item({ type: 'malware' })] }));
  expect(res.status).toBe(400);
  expect((await res.json()).index).toBe(1);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('400 when items is not an array', async () => {
  expect((await POST(makeReq({ items: 'nope' }))).status).toBe(400);
});

it('returns 0 for an empty batch', async () => {
  const res = await POST(makeReq({ items: [] }));
  expect((await res.json()).imported).toBe(0);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('re-scores the vault after a successful import', async () => {
  mockSession.mockResolvedValue({ ownerId: 'o-1', isDemo: false } as never);
  mockCreate.mockResolvedValue({ id: 'i-1' } as never);

  await POST(makeReq({ items: [item()] }));

  expect(mockIntake).toHaveBeenCalledWith('o-1');
});

it('does NOT re-score when nothing was imported', async () => {
  mockSession.mockResolvedValue({ ownerId: 'o-1', isDemo: false } as never);

  await POST(makeReq({ items: [] }));

  expect(mockIntake).not.toHaveBeenCalled();
});

it('still reports success when scoring fails — the items are safely stored', async () => {
  mockSession.mockResolvedValue({ ownerId: 'o-1', isDemo: false } as never);
  mockCreate.mockResolvedValue({ id: 'i-1' } as never);
  mockIntake.mockRejectedValueOnce(new Error('openai down'));

  const res = await POST(makeReq({ items: [item()] }));

  expect(res.status).toBe(200);
  expect((await res.json()).imported).toBe(1);
});

/*
  🔴 TWO ACCOUNTS AT ONE PROVIDER, WHICH IS WHAT A REAL EXPORT LOOKS LIKE.
  The client maps `title: row.service_name`, so a Bitwarden export with a personal
  and a work Google login arrives as two rows labelled "Google". The parser
  (lib/import/csv-parser.ts) keys on `service_name|url` and correctly keeps both;
  this route then collapsed them and answered `duplicatesSkipped: 1` — a number,
  with no way to tell WHICH credential had not come across.
*/
it('keeps two logins at the same provider when their urls differ', async () => {
  const res = await POST(
    makeReq({
      items: [
        item({ title: 'Google', service_name: 'Google', url: 'https://mail.google.com' }),
        item({ title: 'Google', service_name: 'Google', url: 'https://ads.google.com' }),
      ],
    }),
  );

  const body = await res.json();
  expect(body.imported, 'the second Google account was silently dropped').toBe(2);
  expect(body.duplicatesSkipped).toBe(0);
});

it('names the rows it skipped, rather than only counting them', async () => {
  // "left 1 already in your vault untouched" tells an owner that something is
  // missing and not what. J2 step 3: every skip reported with its row number.
  const res = await POST(
    makeReq({
      items: [
        item({ title: 'Chase', service_name: 'Chase', url: 'https://chase.com' }),
        item({ title: 'Chase', service_name: 'Chase', url: 'https://chase.com' }),
      ],
    }),
  );

  const body = await res.json();
  expect(body.imported).toBe(1);
  expect(body.duplicatesSkipped).toBe(1);
  expect(body.duplicateRows, 'the response should identify the skipped rows').toEqual([
    { row: 2, title: 'Chase' },
  ]);
});

it('compares against the vault on url too, so it must read the column', async () => {
  /*
    ⚠️ THE HALF THAT IS EASY TO MISS. If the existing-items query does not
    SELECT url, every stored row looks url-less, the label alone decides again,
    and the fix reaches the in-batch case only. Asserted on the SQL because the
    consequence is invisible in the response.
  */
  const { query } = await import('../../../../lib/db/connection');
  await POST(makeReq({ items: [item()] }));
  const sql = vi.mocked(query).mock.calls[0][0] as string;
  expect(sql).toMatch(/SELECT[^;]*\burl\b[^;]*FROM vault_items/i);
});

/*
  🔴 J4-R4 RAN ON ONE PRODUCER OUT OF TWO, and the comment on that producer named
  the other one. src/app/api/vault/items/route.ts calls `coverNewItem` under
  "A new item matching an existing policy is covered automatically, so an import
  cannot land silently uncovered (J4-R4)" — and `/api/import`, the actual import,
  never called it. lib/rules/policy-materialize.ts says the same thing about
  itself: "so an imported item is not silently uncovered".

  docs/user-journeys.md names the consequence: "every newly imported item lands
  uncovered by default, silently". An owner accepts their proposed policies, then
  imports a CSV, and none of it is reachable by anybody.
*/
describe('imported items are covered against existing policies (J4-R4)', () => {
  it('covers each imported item when the owner has policies', async () => {
    const { coverNewItem } = await import('../../../../lib/rules/policy-materialize');
    vi.mocked(coverNewItem).mockResolvedValue({ policiesMatched: 1 });
    const { query } = await import('../../../../lib/db/connection');
    // vault read (dedupe), then the "any policies at all?" probe.
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValue({ rows: [{ id: 'p-1' }], rowCount: 1 } as never);
    vi.mocked(createItem).mockResolvedValue({ id: 'i-9' } as never);

    const res = await POST(makeReq({ items: [item({ title: 'A' }), item({ title: 'B' })] }));

    expect(coverNewItem).toHaveBeenCalledTimes(2);
    expect((await res.json()).policiesMatched).toBe(2);
  });

  it('does not query policies at all when nothing was imported', async () => {
    // A re-import that skips every row must not do the work of covering nothing.
    const { coverNewItem } = await import('../../../../lib/rules/policy-materialize');
    await POST(makeReq({ items: [] }));
    expect(coverNewItem).not.toHaveBeenCalled();
  });

  it('still reports the import as successful when coverage fails', async () => {
    /*
      The items are stored. A failure in the matching pass must not turn a
      successful import into an error the owner reads as "nothing was saved" —
      the same reasoning as the intake-scoring call above it.
    */
    const { coverNewItem } = await import('../../../../lib/rules/policy-materialize');
    vi.mocked(coverNewItem).mockRejectedValueOnce(new Error('dsql 40001'));
    const { query } = await import('../../../../lib/db/connection');
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValue({ rows: [{ id: 'p-1' }], rowCount: 1 } as never);

    const res = await POST(makeReq({ items: [item()] }));

    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(1);
  });
});
