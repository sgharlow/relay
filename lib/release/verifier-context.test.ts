/**
 * Tests for the verifier decision context.
 *
 * A verifier needs enough to render a real decision — who is asking, why now,
 * what confirming does — while seeing counts and categories ONLY. Never titles,
 * never ciphertext, never plaintext (R6.8, J7-R3, J7-R11).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R3, J7-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { buildVerifierContext } from './verifier-context';

const mockQuery = vi.mocked(query);

function install(opts: {
  release?: Record<string, unknown> | null;
  grants?: { category: string | null; n: string }[];
  history?: { action: string; ts: string; detail: unknown }[];
}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM release_state')) {
      return { rows: opts.release === null ? [] : [opts.release ?? {
        id: 'rs-1',
        owner_id: 'o-1',
        case_id: 'RLY-4K2P-9XQ1',
        trigger_type: 'emergency',
        grace_ends_at: null,
        required_confirmations: 2,
        received_confirmations: 0,
      }] } as never;
    }
    if (sql.includes('FROM access_rules')) {
      return { rows: opts.grants ?? [] } as never;
    }
    if (sql.includes('FROM audit_log')) {
      return { rows: opts.history ?? [] } as never;
    }
    if (sql.includes('FROM users')) {
      return { rows: [{ email: 'margaret@example.com' }] } as never;
    }
    return { rows: [] } as never;
  });
}

beforeEach(() => vi.clearAllMocks());

describe('buildVerifierContext', () => {
  it('NEVER selects title or any ciphertext column', async () => {
    install({});
    await buildVerifierContext('rs-1', 'v-1');

    for (const call of mockQuery.mock.calls) {
      const sql = call[0] as string;
      expect(sql).not.toMatch(/ciphertext|wrapped_data_key|kms_key_id/i);
      expect(sql).not.toMatch(/vi\.title|vault_items\.title/i);
    }
  });

  it('exposes counts and categories but no item identities', async () => {
    install({
      grants: [
        { category: 'finance', n: '4' },
        { category: 'health', n: '2' },
      ],
    });

    const ctx = await buildVerifierContext('rs-1', 'v-1');

    expect(ctx.itemCount).toBe(6);
    expect(ctx.categories.sort()).toEqual(['finance', 'health']);
    expect(JSON.stringify(ctx)).not.toMatch(/title/i);
  });

  it('carries the case ID so a phone conversation has a referent', async () => {
    install({});
    expect((await buildVerifierContext('rs-1', 'v-1')).caseId).toBe('RLY-4K2P-9XQ1');
  });

  it('derives a case ID when the row predates CC7', async () => {
    install({
      release: {
        id: 'rs-1',
        owner_id: 'o-1',
        case_id: null,
        trigger_type: 'emergency',
        grace_ends_at: null,
        required_confirmations: 1,
        received_confirmations: 0,
      },
    });

    expect((await buildVerifierContext('rs-1', 'v-1')).caseId).toMatch(/^RLY-/);
  });

  it('marks a reversible trigger as reversible', async () => {
    install({});
    expect((await buildVerifierContext('rs-1', 'v-1')).reversible).toBe(true);
  });

  it('marks an ESTATE trigger as irreversible — the verifier must know', async () => {
    install({
      release: {
        id: 'rs-1',
        owner_id: 'o-1',
        case_id: 'RLY-1111-2222',
        trigger_type: 'estate',
        grace_ends_at: null,
        required_confirmations: 2,
        received_confirmations: 0,
      },
    });

    expect((await buildVerifierContext('rs-1', 'v-1')).reversible).toBe(false);
  });

  it('summarises what has already been attempted, so "why now" is answerable', async () => {
    install({
      history: [
        { action: 'checkin_reminder_sent', ts: '2026-08-06T10:00:00Z', detail: {} },
        { action: 'checkin_reminder_sent', ts: '2026-08-06T18:00:00Z', detail: {} },
      ],
    });

    const ctx = await buildVerifierContext('rs-1', 'v-1');
    expect(ctx.escalationHistory).toHaveLength(2);
  });

  it('throws when the release does not exist', async () => {
    install({ release: null });
    await expect(buildVerifierContext('nope', 'v-1')).rejects.toThrow();
  });

  it('handles a release with no grants without throwing', async () => {
    install({ grants: [] });

    const ctx = await buildVerifierContext('rs-1', 'v-1');
    expect(ctx.itemCount).toBe(0);
    expect(ctx.categories).toEqual([]);
  });
});
