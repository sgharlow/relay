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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({
  withOccRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  DELEGATE_SCOPES,
  KNOWN_DELEGATE_SCOPES,
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
  it('is exactly the two capabilities a helper actually has', () => {
    /*
      Was five, then four, now two — and each cut was the same finding.
      `policies:propose` went on 2026-08-12 ("granted to every delegate, offered
      by no surface, and could not be applied on approval"). `items:update` and
      `import:run` went on 2026-08-21: no route calls `requireScope` for either,
      and `items:update` is the exact capability the consent panel promises a
      helper will never have.

      THE AUTHORITATIVE EXACT-LIST ASSERTION LIVES HERE AND NOWHERE ELSE. It was
      written out twice — here and in the policies:propose block below — so a
      change to the list failed in two places and could be "fixed" in one. The
      block below now asserts only its own subject.
    */
    expect([...DELEGATE_SCOPES]).toEqual(['items:create', 'people:propose']);
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
    // Two queries since 2026-08-12: the circle check, then the INSERT. Asserting
    // on the INSERT by SQL rather than by position, because a positional mock
    // has broken on an added query four times in this codebase now.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r-1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd-1' }] } as never);

    await expect(createDelegation('o-1', 'u-2')).resolves.toEqual({ id: 'd-1', status: 'pending' });

    const insert = mockQuery.mock.calls.map((c) => String(c[0])).find((q) => q.includes('INSERT INTO delegations'));
    expect(insert).toMatch(/'pending'/);
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
      await expect(recordConsent('d-1', { method, evidenceRef: 'ref', ownerId: 'owner-1' })).resolves.toEqual({
        status: 'active',
      });
    },
  );

  it('REJECTS an unknown method before touching the database', async () => {
    await expect(
      recordConsent('d-1', { method: 'verbal' as never, evidenceRef: null, ownerId: 'owner-1' }),
    ).rejects.toThrow(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('writes the consent artifact to the audit log', async () => {
    pendingThenUpdate();
    await recordConsent('d-1', { method: 'in_person', evidenceRef: null, ownerId: 'owner-1' });

    expect(writeAuditEntry).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ action: 'delegation_consent_recorded' }),
    );
  });

  it('rejects when no pending delegation matches', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'a-1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(recordConsent('nope', { method: 'link', evidenceRef: null, ownerId: 'owner-1' })).rejects.toThrow(
      ValidationError,
    );
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });

  it('only activates a delegation that is still pending', async () => {
    pendingThenUpdate();
    await recordConsent('d-1', { method: 'link', evidenceRef: null, ownerId: 'owner-1' });

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

describe('🔴 cross-owner activation — found by the 2026-08-12 security review', () => {
  it('scopes the activation to the OWNER, not just the delegation id', async () => {
    // This function took no owner at all and updated `WHERE id = $1 AND status =
    // 'pending'`, while the route authenticated a user and passed the path id
    // straight through with no assertOwns. Any signed-in user could activate any
    // pending delegation — granting a stranger setup rights over somebody else's
    // vault and defeating the consent step that makes delegation legitimate.
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'art-1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd-1', owner_id: 'owner-1' }], rowCount: 1 } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await recordConsent('d-1', { method: 'link', evidenceRef: null, ownerId: 'owner-1' });

    const update = mockQuery.mock.calls.map((c) => String(c[0])).find((q) => q.includes('UPDATE delegations'));
    expect(update).toContain('owner_id = $3');
    expect(mockQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE delegations'))?.[1]).toContain('owner-1');
  });

  it('refuses when the delegation belongs to somebody else', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'art-1' }], rowCount: 1 } as never)
      // Owner-scoped UPDATE matches nothing for a stranger.
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await expect(
      recordConsent('someone-elses', { method: 'link', evidenceRef: null, ownerId: 'attacker' }),
    ).rejects.toThrow(/No pending delegation/i);
  });
});

describe('🔴 a helper must already be in the circle — 2026-08-12 security review', () => {
  it('refuses a user who is not a claimed contact of this owner', async () => {
    // `createDelegation` accepted ANY user id. Not exploitable — a UUID is
    // unguessable, the delegate is never notified and cannot act without the
    // owner's id — but it let an owner record "we agreed in person" about
    // somebody they had never named. The consent artifact is the single thing
    // separating a helper from a stranger with write access, and a FALSE
    // artifact is worse than none because it looks like the control working.
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await expect(createDelegation('o-1', 'a-stranger')).rejects.toThrow(ValidationError);
  });

  it('never reaches the INSERT when the delegate is outside the circle', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await expect(createDelegation('o-1', 'a-stranger')).rejects.toThrow();
    expect(mockQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO delegations'))).toBe(false);
  });

  it('accepts a claimed recipient or verifier, and excludes revoked in SQL', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r-1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd-1' }], rowCount: 1 } as never);

    await expect(createDelegation('o-1', 'u-2')).resolves.toEqual({ id: 'd-1', status: 'pending' });

    const lookup = String(mockQuery.mock.calls[0][0]);
    expect(lookup).toMatch(/claimed_user_id = \$2/);
    expect(lookup).toMatch(/<>\s*'revoked'/);
  });
});

describe('🔴 policies:propose removed — 2026-08-12', () => {
  it('is no longer a delegate scope', () => {
    // Granted to every delegate, offered by no surface, and `decideApproval`
    // claimed a `policy` approval without applying one. Dropped rather than
    // built because it does not fit the read boundary it would live inside: a
    // helper can see neither the items nor the recipients a policy joins.
    expect([...DELEGATE_SCOPES]).not.toContain('policies:propose');
  });

  it('is still speakable, so the enforcement layer can refuse it by name', () => {
    /*
      Removed from the GRANT list, kept in the KNOWN list — and that difference
      is load-bearing. Rows created before 2026-08-12 still carry the string in
      `delegations.scopes`, so `requireScope` and `getActiveDelegation` both have
      to be able to name it in order to reject it. A type admitting only what is
      currently granted would make the retired value unspeakable in exactly the
      code whose job is to throw it away.

      The exact grant list is asserted once, in the DELEGATE_SCOPES block above.
    */
    expect([...KNOWN_DELEGATE_SCOPES]).toContain('policies:propose');
    expect([...DELEGATE_SCOPES]).not.toContain('policies:propose');
  });

  it('WRITES the scopes rather than inheriting the database default', async () => {
    // Migration 009 defaults this column to a five-scope list that still
    // contains `policies:propose`. Letting the default speak would have the
    // database granting a capability the application has removed.
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r-1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd-1' }] } as never);

    await createDelegation('o-1', 'u-2');

    const insert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO delegations'));
    expect(String(insert?.[0])).toMatch(/scopes/);
    expect(String((insert?.[1] as unknown[])[2])).not.toContain('policies:propose');
  });
});

/**
 * 🔴 A GRANT NOTHING HONOURS — the other two, found 2026-08-21.
 *
 * `policies:propose` was removed on 2026-08-12 for being "a granted capability
 * that silently does nothing… worse than an absent one, because it reads as
 * working". Its two neighbours were left behind: NOTHING anywhere calls
 * `requireScope(actor, 'items:update')` or `requireScope(actor, 'import:run')`
 * — `/api/import` is `requireOwner` and `PUT /api/vault/items/[id]` is
 * owner-only — so every delegation created since the feature shipped was written
 * with two capabilities that no route consults.
 *
 * ⚠️ AND ONE OF THEM CONTRADICTS THE CONSENT ARTIFACT. The panel an owner reads
 * while deciding whether to hand somebody a key to their vault states, in these
 * words, that a helper can never "change or delete an item once it is in — only
 * you can". `items:update` is the grant that would make that false. It is inert
 * today only because no route asks; the day one does, every delegation already
 * consented to under that sentence silently acquires edit rights over the
 * owner's vault, with no second conversation. That is not a latent feature, it
 * is a latent breach of the one artifact that makes delegation legitimate.
 *
 * Read from the routes rather than asserted from a list, so this cannot go green
 * on a scope somebody meant to wire and did not.
 */
describe('every scope a delegate is granted is honoured by some route', () => {
  /** Scopes an actual handler gates on, read from the handlers themselves. */
  function scopesHonouredByARoute(): Set<string> {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === 'route.ts') {
          const src = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/\/\/[^\n]*/g, ' ');
          for (const m of src.matchAll(/requireScope\(\s*\w+\s*,\s*'([^']+)'/g)) found.add(m[1]);
        }
      }
    };
    walk('src/app/api');
    return found;
  }

  it('grants nothing that no handler consults', () => {
    const honoured = scopesHonouredByARoute();
    const dead = DELEGATE_SCOPES.filter((s) => !honoured.has(s));
    expect(
      dead,
      'These are written into every delegation row and gated on by no route. ' +
        'Wire them to a handler or stop granting them — a capability that reads ' +
        'as working and does nothing is the defect policies:propose was removed for.',
    ).toEqual([]);
  });

  it('does not grant the edit the consent panel promises a helper can never do', () => {
    // src/app/(owner)/approvals/HelperSection.tsx: "A helper can never … change
    // or delete an item once it is in — only you can."
    expect([...DELEGATE_SCOPES]).not.toContain('items:update');
  });
});

/**
 * 🔴 REMOVING A SCOPE FROM THE LIST DOES NOT REMOVE IT FROM THE ROWS.
 *
 * `createDelegation` writes `DELEGATE_SCOPES` into `delegations.scopes` at
 * creation time, so a row created before a scope was withdrawn still CARRIES it
 * — and `requireScope` asks the row, not the list. `policies:propose` was
 * removed from the constant on 2026-08-12 and every delegation created before
 * that date still names it in the database to this day.
 *
 * So the guard has to sit where the stale value ENTERS the system, which is the
 * one function that reads that column. Narrowing the constant alone would be a
 * fix that looks complete in the diff and changes nothing for any row that
 * already exists.
 */
describe('a stored scope the product no longer grants is not honoured', () => {
  it('drops a retired scope on the way out of the database', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'd-1', scopes: ['items:create', 'items:update', 'policies:propose'] }],
    } as never);

    const active = await getActiveDelegation('u-2', 'o-1');

    expect(active?.scopes).toEqual(['items:create']);
  });

  it('keeps every scope that IS still granted', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'd-1', scopes: [...DELEGATE_SCOPES] }],
    } as never);

    const active = await getActiveDelegation('u-2', 'o-1');

    expect(active?.scopes).toEqual([...DELEGATE_SCOPES]);
  });

  it('survives a row whose scopes column is null or malformed, granting nothing', async () => {
    // A row is never more trusted than its data — the same rule
    // `readStandbyState` applies. Unreadable resolves to the LEAST privilege.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd-1', scopes: null }] } as never);

    await expect(getActiveDelegation('u-2', 'o-1')).resolves.toEqual({ id: 'd-1', scopes: [] });
  });
});
