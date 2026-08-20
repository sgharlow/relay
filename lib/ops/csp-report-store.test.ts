/**
 * The CSP sink, proven not to be able to make a page worse.
 *
 * This module is called from a reporting endpoint, by a browser that has just
 * had something blocked, on a page a person is looking at. Every one of these
 * tests is really the same test asked a different way: does it stay quiet when
 * the database is unhappy?
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  recordCspViolation,
  _resetCspStoreForTesting,
  _cspStoreUnavailable,
} from './csp-report-store';

const mockQuery = vi.mocked(query);

const violation = {
  disposition: 'report',
  directive: 'script-src-elem',
  blocked: 'inline',
  document: '/vault',
};

beforeEach(() => {
  mockQuery.mockReset();
  _resetCspStoreForTesting();
});

describe('the happy path', () => {
  it('writes one row and says so', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await expect(recordCspViolation(violation)).resolves.toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('stores the four fields and nothing else', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await recordCspViolation(violation);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO csp_reports');
    expect(params).toEqual(['report', 'script-src-elem', 'inline', '/vault']);
    // 🔴 There is no column for script-sample and there must never be one: on a
    // page that has just decrypted a vault item, it is a slice of plaintext.
    expect(sql).not.toContain('sample');
  });

  it('carries disposition, which is what makes the rest worth storing', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await recordCspViolation({ ...violation, disposition: 'enforce' });
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('disposition');
    // 'enforce' means something ACTUALLY broke for a user; 'report' means the
    // stricter policy would have. Indistinguishable without this.
    expect((params as unknown[])[0]).toBe('enforce');
  });

  it('accepts nulls, because a browser may omit any of them', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await expect(
      recordCspViolation({ disposition: null, directive: null, blocked: null, document: null }),
    ).resolves.toBe(true);
  });
});

describe('when the table is not there yet', () => {
  it('latches after one failure instead of retrying per report', async () => {
    /*
      A broken page can emit many reports per second. Retrying the write for
      every one turns a missing migration into sustained load at exactly the
      moment something is already wrong.
    */
    const undefinedTable = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    mockQuery.mockRejectedValue(undefinedTable);

    expect(_cspStoreUnavailable()).toBe(false);
    await expect(recordCspViolation(violation)).resolves.toBe(false);
    expect(_cspStoreUnavailable(), 'the latch did not trip').toBe(true);

    await recordCspViolation(violation);
    await recordCspViolation(violation);
    expect(mockQuery, 'it kept trying after the table was known to be absent').toHaveBeenCalledTimes(1);
  });

  it('never throws, so a missing migration cannot reach the browser', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('nope'), { code: '42P01' }));
    await expect(recordCspViolation(violation)).resolves.toBe(false);
  });
});

describe('when the database is merely unhappy', () => {
  it('swallows a timeout without latching', async () => {
    /*
      A blip is not a configuration fact. Latching on one would silently disable
      the sink for the life of the process over a transient error.
    */
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: '57014' }));
    await expect(recordCspViolation(violation)).resolves.toBe(false);
    expect(_cspStoreUnavailable(), 'a timeout should not latch').toBe(false);

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    await expect(recordCspViolation(violation)).resolves.toBe(true);
  });

  it('swallows a permission denial without throwing', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('permission denied'), { code: '42501' }));
    await expect(recordCspViolation(violation)).resolves.toBe(false);
  });

  it('swallows an error with no code at all', async () => {
    mockQuery.mockRejectedValue(new Error('something else entirely'));
    await expect(recordCspViolation(violation)).resolves.toBe(false);
  });
});

describe('the route that calls it', () => {
  const ROUTE = 'src/app/api/csp-report/route.ts';

  it('awaits the write, so a serverless instance is not frozen mid-insert', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(ROUTE, 'utf8');
    expect(src).toContain('await recordCspViolation(');
  });

  it('still writes to stderr as well', async () => {
    /*
      Kept, not replaced: it costs nothing, it is what works before migration 038
      reaches a cluster, and a tail is the fastest way to watch a policy change
      land in real time.
    */
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(ROUTE, 'utf8')).toContain('process.stderr.write');
  });
});
