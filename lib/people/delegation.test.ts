/**
 * Tests for delegation and consent.
 *
 * The caregiver wedge has three roles the schema treats as one: the buyer
 * (adult child), the data owner (parent), and the recipient (the child again).
 * The parent stays the owner; the child becomes a scoped delegate.
 *
 * Delegation NEVER activates without a recorded consent artifact (J3-R2), and
 * consent must be obtainable without a smartphone (J3-R3).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R3, J3-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  DELEGATE_SCOPES,
  CONSENT_METHODS,
  createDelegation,
  recordConsent,
  getActiveDelegation,
  revokeDelegation,
  delegateActor,
} from './delegation';
import { ValidationError } from '../validation';

const mockQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('DELEGATE_SCOPES', () => {
  it('is exactly the five setup scopes', () => {
    expect([...DELEGATE_SCOPES]).toEqual([
      'items:create',
      'items:update',
      'import:run',
      'people:propose',
      'policies:propose',
    ]);
  });

  it('NEVER grants decrypt, trigger control, or self-grant capability', () => {
    const joined = DELEGATE_SCOPES.join(' ');
    expect(joined).not.toMatch(/decrypt|kms|trigger|arm|release|cancel|recipients:create/i);
  });

  it('grants only propose-level authority over people and policies', () => {
    for (const s of DELEGATE_SCOPES) {
      if (s.startsWith('people:') || s.startsWith('policies:')) {
        expect(s).toMatch(/:propose$/);
      }
    }
  });
});

describe('CONSENT_METHODS', () => {
  it('includes a path that needs no smartphone (J3-R3)', () => {
    expect(CONSENT_METHODS).toContain('paper_upload');
    expect(CONSENT_METHODS).toContain('in_person');
  });
});

describe('createDelegation', () => {
  it('creates a PENDING delegation — never active on creation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd-1' }] } as never);

    await expect(createDelegation('o-1', 'u-2')).resolves.toEqual({ id: 'd-1', status: 'pending' });
    expect(mockQuery.mock.calls[0][0] as string).toMatch(/'pending'/);
  });

  it('refuses a delegate who is also the owner', async () => {
    await expect(createDelegation('o-1', 'o-1')).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('recordConsent', () => {
  function pendingThenUpdate() {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'a-1' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd-1', owner_id: 'o-1' }] } as never);
  }

  it.each(['link', 'in_person', 'paper_upload'] as const)(
    'accepts consent method %s',
    async (method) => {
      pendingThenUpdate();
      await expect(recordConsent('d-1', { method, evidenceRef: 'ref' })).resolves.toEqual({
        status: 'active',
      });
    },
  );

  it('REJECTS an unknown method before touching the database', async () => {
    await expect(
      recordConsent('d-1', { method: 'verbal' as never, evidenceRef: null }),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('writes the consent artifact to the audit log', async () => {
    pendingThenUpdate();
    await recordConsent('d-1', { method: 'in_person', evidenceRef: null });

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ action: 'delegation_consent_recorded' }),
    );
  });

  it('rejects when no pending delegation matches', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'a-1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(recordConsent('nope', { method: 'link', evidenceRef: null })).rejects.toThrow(
      ValidationError,
    );
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });

  it('only activates a delegation that is still pending', async () => {
    pendingThenUpdate();
    await recordConsent('d-1', { method: 'link', evidenceRef: null });

    const update = mockQuery.mock.calls[1][0] as string;
    expect(update).toMatch(/status\s*=\s*'active'/i);
    expect(update).toMatch(/status\s*=\s*'pending'/i);
  });
});

describe('getActiveDelegation', () => {
  it('returns null when nothing is active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await expect(getActiveDelegation('u-2', 'o-1')).resolves.toBeNull();
  });

  it('excludes revoked delegations in SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await getActiveDelegation('u-2', 'o-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/revoked_at IS NULL/i);
    expect(sql).toMatch(/status\s*=\s*'active'/i);
  });

  it('is scoped to the exact (delegate, owner) pair', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await getActiveDelegation('u-2', 'o-1');

    expect(mockQuery.mock.calls[0][1]).toEqual(['u-2', 'o-1']);
  });

  it('returns id and scopes for an active delegation', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'd-1', scopes: ['items:create'] }],
    } as never);

    await expect(getActiveDelegation('u-2', 'o-1')).resolves.toEqual({
      id: 'd-1',
      scopes: ['items:create'],
    });
  });
});

describe('revokeDelegation', () => {
  it('stamps revoked_at and audits', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd-1' }] } as never);

    await revokeDelegation('o-1', 'd-1');

    expect(mockQuery.mock.calls[0][0] as string).toMatch(/revoked_at\s*=\s*now\(\)/i);
    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ action: 'delegation_revoked' }),
    );
  });

  it('does not audit when nothing was revoked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await revokeDelegation('o-1', 'nope');
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });
});

describe('delegateActor', () => {
  it('namespaces the audit actor so delegate action is distinguishable', () => {
    expect(delegateActor('d-1')).toBe('delegate:d-1');
  });
});
