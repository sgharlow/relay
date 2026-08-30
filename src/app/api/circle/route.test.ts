/**
 * The whole "building the circle of trust" screen, in one call.
 *
 * This handler executed no test until 2026-08-30 despite being the widest read
 * in the product: it touches vault items, access rules, both roster tables,
 * policies, passkeys, break-glass codes, drill history and delivery events. Four
 * properties had nothing holding them, and every one of them fails INVISIBLY —
 * the response is still 200 and the screen still renders.
 *
 * 🔴 METADATA ONLY (CC2). This route reads `vault_items` and must never select
 * `ciphertext`, `wrapped_data_key` or `kms_key_id`. A widened SELECT would leak
 * ciphertext into an owner-facing JSON body and break nothing visible. Asserted
 * against the SQL text, which is the only place that boundary exists.
 *
 * 🔴 `claimed_user_id` IS DESTRUCTURED OUT OF EVERY PERSON. It is another user's
 * account id, and the owner is given `fingerprint`, `has_passkey` and
 * `has_break_glass` derived from it instead. A spread that forgot to remove it
 * would ship the raw id to the browser.
 *
 * 🔴 A BREAK-GLASS CODE COUNTS ONLY WHILE IT IS STILL A WAY BACK IN. The query
 * filters `used_at IS NULL AND expires_at > now()`; dropping either half would
 * tell an owner a spent or lapsed code is a live fallback, on the screen whose
 * entire purpose is answering "who could still get in if they lost their phone".
 *
 * 🔴 ABSENT DELIVERY EVIDENCE MEANS UNHEARD, NEVER FINE. `latestDeliveryByEmail`
 * failing is swallowed so a delivery-history outage cannot take down the screen
 * — and the field must then be `null`, not a cheerful default.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2, J4-R5, J4-R13, CC2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../lib/notify/delivery-events', () => ({
  latestDeliveryByEmail: vi.fn(async () => new Map()),
}));
vi.mock('../../../../lib/release/fire-drill', () => ({
  fireDrillStatus: vi.fn(async () => new Map()),
}));

import { requireOwner } from '../../../../lib/http/owner-route';
import { query } from '../../../../lib/db/connection';
import { latestDeliveryByEmail } from '../../../../lib/notify/delivery-events';
import { fireDrillStatus } from '../../../../lib/release/fire-drill';
import { fingerprintFor } from '../../../../lib/people/fingerprint';
import { GET } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockQuery = vi.mocked(query);
const mockDelivery = vi.mocked(latestDeliveryByEmail);
const mockDrills = vi.mocked(fireDrillStatus);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const CLAIMED_USER = 'e5e5e5e5-2222-4333-8444-555566667777';
const ITEM_CRIT = '11111111-2222-4333-8444-555566667777';
const REC = 'aaaaaaaa-2222-4333-8444-555566667777';
const VER = 'bbbbbbbb-2222-4333-8444-555566667777';

/** Rows returned per table, overridable per test. */
interface Fixture {
  vault_items: Record<string, unknown>[];
  access_rules: Record<string, unknown>[];
  recipients: Record<string, unknown>[];
  verifiers: Record<string, unknown>[];
  access_policies: Record<string, unknown>[];
  webauthn_credentials: Record<string, unknown>[];
  break_glass_codes: Record<string, unknown>[];
}

let fixture: Fixture;

/**
 * Routed on the SQL text rather than on call order, so a test cannot silently
 * start asserting against a different table when the route is reordered.
 */
function routeQuery(sql: unknown): { rows: Record<string, unknown>[] } {
  const s = String(sql);
  if (/FROM vault_items/.test(s)) return { rows: fixture.vault_items };
  if (/FROM access_rules/.test(s)) return { rows: fixture.access_rules };
  if (/FROM recipients/.test(s)) return { rows: fixture.recipients };
  if (/FROM verifiers/.test(s)) return { rows: fixture.verifiers };
  if (/FROM access_policies/.test(s)) return { rows: fixture.access_policies };
  if (/FROM webauthn_credentials/.test(s)) return { rows: fixture.webauthn_credentials };
  if (/FROM break_glass_codes/.test(s)) return { rows: fixture.break_glass_codes };
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
    vault_items: [
      {
        id: ITEM_CRIT,
        title: 'Primary email',
        category: 'email',
        criticality: 'critical',
        is_root_credential: true,
        irreplaceable: false,
        importance_score: 0.9,
      },
    ],
    access_rules: [],
    recipients: [
      {
        id: REC,
        name: 'April',
        role: 'caregiver',
        email: 'April@Example.com',
        email_secondary: null,
        standby_state: 'confirmed',
        claimed_user_id: CLAIMED_USER,
        break_glass_only: false,
      },
    ],
    verifiers: [
      {
        id: VER,
        name: 'Ben',
        email: 'ben@example.com',
        email_secondary: null,
        standby_state: 'invited',
        claimed_user_id: null,
        break_glass_only: false,
      },
    ],
    access_policies: [],
    webauthn_credentials: [],
    break_glass_codes: [],
  };
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockQuery.mockImplementation(async (sql: unknown) => routeQuery(sql) as never);
  mockDelivery.mockResolvedValue(new Map());
  mockDrills.mockResolvedValue(new Map());
});

describe('the zero-knowledge boundary (CC2)', () => {
  it('never selects ciphertext, the wrapped key, or the key id', async () => {
    await GET();
    const sql = sqlFor(/FROM vault_items/);
    expect(sql).not.toMatch(/ciphertext/i);
    expect(sql).not.toMatch(/wrapped_data_key/i);
    expect(sql).not.toMatch(/kms_key_id/i);
    // And it is not a blanket SELECT that would pick them up by default.
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('scopes every read to the session owner', async () => {
    await GET();
    for (const [sql, params] of mockQuery.mock.calls) {
      const s = String(sql);
      if (/FROM (vault_items|access_rules|recipients|verifiers|access_policies)/.test(s)) {
        expect(s).toMatch(/owner_id = \$1/);
        expect(params).toEqual([OWNER]);
      }
    }
  });
});

describe('what each person in the circle is allowed to reveal', () => {
  it('never returns another user’s account id', async () => {
    const body = await (await GET()).json();
    expect(body.recipients[0]).not.toHaveProperty('claimed_user_id');
    expect(JSON.stringify(body)).not.toContain(CLAIMED_USER);
  });

  it('gives a bound person the fingerprint the owner will read aloud', async () => {
    const body = await (await GET()).json();
    // Derived, never stored — and it must be THIS binding's phrase, so the
    // owner comparing it out of band is comparing something meaningful.
    expect(body.recipients[0].fingerprint).toBe(
      fingerprintFor({ ownerId: OWNER, personId: REC, claimedUserId: CLAIMED_USER }),
    );
  });

  it('gives an unbound person no fingerprint at all', async () => {
    // A phrase for somebody who has bound nothing would be a blind "yes" button:
    // the owner asserting they compared something they were never shown.
    const body = await (await GET()).json();
    expect(body.verifiers[0].fingerprint).toBeNull();
  });

  it('reports a passkey as a boolean, never the credential', async () => {
    fixture.webauthn_credentials = [{ user_id: CLAIMED_USER }];
    const body = await (await GET()).json();
    expect(body.recipients[0].has_passkey).toBe(true);
    expect(body.verifiers[0].has_passkey).toBe(false);
  });

  it('does not credit a passkey belonging to a different user', async () => {
    fixture.webauthn_credentials = [{ user_id: 'somebody-else' }];
    const body = await (await GET()).json();
    expect(body.recipients[0].has_passkey).toBe(false);
  });
});

describe('a break-glass code counts only while it is still a way back in', () => {
  it('requires the code to be unspent AND unexpired', async () => {
    await GET();
    const sql = sqlFor(/FROM break_glass_codes/);
    expect(sql).toMatch(/used_at IS NULL/);
    expect(sql).toMatch(/expires_at > now\(\)/);
  });

  it('reports has_break_glass against the roster row', async () => {
    fixture.break_glass_codes = [{ person_id: VER }];
    const body = await (await GET()).json();
    expect(body.verifiers[0].has_break_glass).toBe(true);
    expect(body.recipients[0].has_break_glass).toBe(false);
  });

  it('skips the lookup entirely when the circle is empty', async () => {
    fixture.recipients = [];
    fixture.verifiers = [];
    await GET();
    expect(mockQuery.mock.calls.some((c) => /break_glass_codes/.test(String(c[0])))).toBe(false);
    expect(mockQuery.mock.calls.some((c) => /webauthn_credentials/.test(String(c[0])))).toBe(false);
  });
});

describe('delivery evidence — absent means unheard', () => {
  it('reports null when nothing has been heard about an address', async () => {
    const body = await (await GET()).json();
    expect(body.recipients[0].delivery).toBeNull();
  });

  it('matches the address case-insensitively', async () => {
    // The roster holds 'April@Example.com'; the event map is keyed lowercase.
    mockDelivery.mockResolvedValueOnce(
      new Map([['april@example.com', { status: 'bounced' }]]) as never,
    );
    const body = await (await GET()).json();
    expect(body.recipients[0].delivery).toEqual({ status: 'bounced' });
  });

  it('keeps the screen up when delivery history is unavailable', async () => {
    // A delivery-history outage must not take down the screen that shows who
    // can reach what — and every field must then read null, not "fine".
    mockDelivery.mockRejectedValueOnce(new Error('events table gone'));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipients[0].delivery).toBeNull();
    expect(body.verifiers[0].delivery).toBeNull();
  });
});

describe('what the screen tells the owner', () => {
  it('names an uncovered critical item instead of printing a UUID', async () => {
    const body = await (await GET()).json();
    expect(body.coverage.uncoveredCritical).toEqual([
      { id: ITEM_CRIT, title: 'Primary email' },
    ]);
  });

  it('offers proposals only while the owner has authored no policy', async () => {
    const body = await (await GET()).json();
    expect(body.policyCount).toBe(0);
    expect(body.proposals.length).toBeGreaterThan(0);
  });

  it('stops proposing once a policy exists', async () => {
    fixture.access_policies = [{ id: 'p-1' }];
    const body = await (await GET()).json();
    expect(body.policyCount).toBe(1);
    expect(body.proposals).toEqual([]);
  });

  it('attaches the drill record, which is evidence about a human', async () => {
    mockDrills.mockResolvedValueOnce(new Map([[VER, { acknowledgedAt: '2026-08-30' }]]) as never);
    const body = await (await GET()).json();
    expect(body.verifiers[0].drill).toEqual({ acknowledgedAt: '2026-08-30' });
    expect(body.recipients[0].drill).toBeNull();
  });

  it('reports the item count the screen counts against', async () => {
    expect((await (await GET()).json()).itemCount).toBe(1);
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
    expect(mockDrills).not.toHaveBeenCalled();
  });
});
