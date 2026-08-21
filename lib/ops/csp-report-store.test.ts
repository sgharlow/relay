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

/**
 * 🔴 THE SINK HAD NO READER, AND D9 WAS CLOSED ANYWAY.
 *
 * Migration 038 states its own purpose: "observe real traffic, remove what
 * nothing needs, then take the middleware decision on evidence." This module
 * writes the rows. Until 2026-08-21 a grep for `FROM csp_reports` across lib/,
 * src/, scripts/, docs/ and PROJECT.yaml returned nothing at all — no script, no
 * endpoint, no query. The report-only rung exists to answer one question and
 * there was no way to ask it.
 *
 * Moving evidence from a log that forgets in a day to a table nobody opens is
 * not progress; it is the same silence with a longer retention. And the
 * column-use guard could not see it — `schema-columns-are-used.test.ts` matches
 * a column mentioned anywhere, so `disposition`, `directive`, `blocked` and
 * `document` all passed on the strength of appearing in the INSERT above.
 *
 * ⚠️ THE READER CANNOT BE RUN HERE. It needs `.env.local`, which points at the
 * production cluster. So this asserts the reader EXISTS and asks the right
 * question; whether its output is useful is a thing a person finds out by
 * running it. That is the honest limit of a credential-free suite, and stating
 * it is better than a check that implies more than it does.
 */
describe('something can read what this writes', () => {
  const READER = 'scripts/verify-csp.ts';

  it('a reader exists', async () => {
    const { existsSync } = await import('node:fs');
    expect(
      existsSync(READER),
      `${READER} is gone. csp_reports is then a write-only table again, and the report-only ` +
        'CSP rung has no way to produce the evidence it exists to gather — which is the state ' +
        'D9 was closed in.',
    ).toBe(true);
  });

  it('it actually queries the table, rather than being a file named after one', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(READER, 'utf8');
    expect(src).toMatch(/FROM csp_reports/i);
    // The split that is the whole point: `enforce` means a real page broke,
    // `report` means the stricter policy would have blocked and nothing did.
    expect(src, 'the reader does not distinguish enforced from report-only').toContain(
      'disposition',
    );
  });

  it('never deletes — pruning is a decision about the observation window', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(READER, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(src).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
  });
});
