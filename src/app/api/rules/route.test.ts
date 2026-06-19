/**
 * Tests for /api/rules (collection) and /api/rules/[id]
 *
 * Validates: Requirements 3.3, 3.4, 3.5, 3.8
 *  - estate + reversible=true → 400 (Property 7 surfaced at the route)
 *  - cross-owner reference → 403
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/rules/access-rules', async (io) => {
  const actual = await io<typeof import('../../../../lib/rules/access-rules')>();
  return { ...actual, listRules: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn() };
});
vi.mock('../../../../lib/release/provisioning', () => ({ ensureReleaseState: vi.fn(async () => ({})) }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { createRule } from '../../../../lib/rules/access-rules';
import { ensureReleaseState } from '../../../../lib/release/provisioning';
// Real (unmocked) IntegrityError — same class owner-route's mapError checks.
import { IntegrityError } from '../../../../lib/db/integrity';
import { POST } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockCreate = vi.mocked(createRule);
const mockEnsure = vi.mocked(ensureReleaseState);

function makeReq(body?: unknown) {
  return { json: async () => body } as never;
}
function validRule(overrides: Record<string, unknown> = {}) {
  return {
    vault_item_id: 'item-1',
    recipient_id: 'rec-1',
    trigger_type: 'emergency',
    scope: 'view',
    reversible: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('POST 201 on a valid rule and provisions the trigger release_state', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'rule-1' } as never);
  const res = await POST(makeReq(validRule()));
  expect(res.status).toBe(201);
  expect(mockEnsure).toHaveBeenCalledWith('owner-1', 'emergency');
});

it('POST 400 listing missing fields', async () => {
  const res = await POST(makeReq({ scope: 'view' }));
  expect(res.status).toBe(400);
  expect((await res.json()).message).toContain('vault_item_id');
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST 400 on estate + reversible=true (Property 7)', async () => {
  const res = await POST(makeReq(validRule({ trigger_type: 'estate', reversible: true })));
  expect(res.status).toBe(400);
  expect((await res.json()).field).toBe('reversible');
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST 403 when a referenced row belongs to another owner', async () => {
  mockCreate.mockRejectedValueOnce(new IntegrityError('UNAUTHORIZED', 'cross-owner vault_items'));
  const res = await POST(makeReq(validRule()));
  expect(res.status).toBe(403);
});
