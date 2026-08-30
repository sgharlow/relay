/**
 * Where the browser argues with the Content-Security-Policy.
 *
 * This handler executed no test until 2026-08-30, which left the most
 * consequential omission in the file unguarded — an omission being, by nature,
 * the thing a reader does not notice is missing:
 *
 * 🔴 `script-sample` IS DELIBERATELY NOT READ. A CSP report can carry up to 40
 * characters of the offending inline script, and on a page that has just
 * decrypted a vault item, forty characters of the DOM is plaintext from
 * somebody's vault. It is dropped explicitly rather than merely not being read —
 * and nothing asserted that, so a later change adding "just the sample, for
 * debugging" would have been a plaintext exfiltration path through an
 * unauthenticated endpoint. The test below fails if the sample ever reaches the
 * store or the log.
 *
 * 🔴 BOTH REPORT SHAPES, BECAUSE BROWSERS DISAGREE. `report-uri` posts
 * `{ "csp-report": {...} }` with kebab-case keys; the Reporting API posts an
 * ARRAY of `{ type, body }` with camelCase. Supporting only one means silently
 * collecting nothing from half the browsers — which looks exactly like a clean
 * policy, and a clean policy is what this endpoint exists to disprove.
 *
 * 🔴 `disposition` IS THE FIELD THAT MAKES THE REST WORTH STORING. `enforce`
 * means a real user met a broken page; `report` means the stricter policy would
 * have blocked something and nothing broke. Losing it makes the two
 * indistinguishable, which is the difference between a defect and evidence.
 *
 * 🔴 ALWAYS 204. A reporting endpoint that answers differently can be probed.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../lib/ops/csp-report-store', () => ({
  recordCspViolation: vi.fn(async () => undefined),
}));
vi.mock('../../../../lib/http/rate-limit', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/rate-limit',
  );
  return { ...actual, rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) };
});

import { recordCspViolation } from '../../../../lib/ops/csp-report-store';
import { rateLimit } from '../../../../lib/http/rate-limit';
import { POST } from './route';

const mockRecord = vi.mocked(recordCspViolation);
const mockRateLimit = vi.mocked(rateLimit);

/** 40 characters of a page that has just decrypted a vault item. */
const SECRET_SAMPLE = 'const pw = "hunter2-the-real-one"; login(';

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const LEGACY = {
  'csp-report': {
    'effective-directive': 'script-src',
    'blocked-uri': 'inline',
    'document-uri': 'https://relaystandby.com/vault?item=abc123',
    disposition: 'report',
    'script-sample': SECRET_SAMPLE,
  },
};

const REPORTING_API = [
  {
    type: 'csp-violation',
    body: {
      effectiveDirective: 'style-src',
      blockedURL: 'https://cdn.example.com/x.css',
      documentURL: 'https://relaystandby.com/access?token=zzz',
      disposition: 'enforce',
      sample: SECRET_SAMPLE,
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockRecord.mockResolvedValue(undefined as never);
});

describe('the sample is never stored', () => {
  it('drops script-sample from a report-uri payload', async () => {
    await POST(req(LEGACY));
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const stored = JSON.stringify(mockRecord.mock.calls[0][0]);
    expect(stored).not.toContain('hunter2');
    expect(stored).not.toContain(SECRET_SAMPLE);
    expect(mockRecord.mock.calls[0][0]).not.toHaveProperty('sample');
    expect(mockRecord.mock.calls[0][0]).not.toHaveProperty('script-sample');
  });

  it('drops sample from a Reporting API payload', async () => {
    await POST(req(REPORTING_API));
    const stored = JSON.stringify(mockRecord.mock.calls[0][0]);
    expect(stored).not.toContain('hunter2');
  });

  it('stores exactly four fields and no others', async () => {
    // An allow-list assertion rather than a deny-list: a new field added to the
    // stored object has to be justified by a test change, which is the point.
    await POST(req(LEGACY));
    expect(Object.keys(mockRecord.mock.calls[0][0]).sort()).toEqual([
      'blocked',
      'directive',
      'disposition',
      'document',
    ]);
  });
});

describe('both report shapes', () => {
  it('reads the kebab-case report-uri shape', async () => {
    await POST(req(LEGACY));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        directive: 'script-src',
        blocked: 'inline',
        disposition: 'report',
      }),
    );
  });

  it('reads the camelCase Reporting API shape', async () => {
    // Supporting only the other one would collect nothing from half the
    // browsers, and read as a clean policy.
    await POST(req(REPORTING_API));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        directive: 'style-src',
        blocked: 'https://cdn.example.com/x.css',
        disposition: 'enforce',
      }),
    );
  });

  it('records every violation in a batch', async () => {
    await POST(req([REPORTING_API[0], REPORTING_API[0]]));
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it('ignores report types that are not CSP violations', async () => {
    await POST(req([{ type: 'deprecation', body: { id: 'x' } }]));
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe('what it strips and bounds', () => {
  it('drops the query string from the document URI', async () => {
    // `?item=abc123` and `?token=zzz` are both identifiers that do not belong
    // in an operational log.
    await POST(req(LEGACY));
    expect(mockRecord.mock.calls[0][0].document).toBe('https://relaystandby.com/vault');

    vi.clearAllMocks();
    mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    await POST(req(REPORTING_API));
    expect(mockRecord.mock.calls[0][0].document).toBe('https://relaystandby.com/access');
  });

  it('truncates a long field rather than storing it whole', async () => {
    await POST(
      req({ 'csp-report': { 'effective-directive': 'd'.repeat(500), disposition: 'report' } }),
    );
    expect(String(mockRecord.mock.calls[0][0].directive)).toHaveLength(200);
  });

  it('records nulls rather than inventing values for absent fields', async () => {
    await POST(req({ 'csp-report': {} }));
    expect(mockRecord).toHaveBeenCalledWith({
      disposition: null,
      directive: null,
      blocked: null,
      document: null,
    });
  });

  it('falls back to violated-directive when effective-directive is absent', async () => {
    await POST(req({ 'csp-report': { 'violated-directive': 'img-src' } }));
    expect(mockRecord.mock.calls[0][0].directive).toBe('img-src');
  });
});

describe('it cannot be probed', () => {
  it('answers 204 for a well-formed report', async () => {
    expect((await POST(req(LEGACY))).status).toBe(204);
  });

  it('answers 204 for a payload it does not understand, storing nothing', async () => {
    const res = await POST(req({ nonsense: true }));
    expect(res.status).toBe(204);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('answers 204 when rate limited, storing nothing', async () => {
    mockRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 30 });
    const res = await POST(req(LEGACY));
    expect(res.status).toBe(204);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('answers 204 for a body past the ceiling', async () => {
    const res = await POST(
      req({ 'csp-report': { 'blocked-uri': 'x'.repeat(9000), disposition: 'report' } }),
    );
    expect(res.status).toBe(204);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
