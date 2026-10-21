/**
 * Feature: relay-h0-mvp (CC9, B12.i)
 */
import { describe, it, expect } from 'vitest';
import { runCanary } from './canary-run.ts';
import { productionKey } from './heartbeat-alert.ts';
import type { CanaryCheck } from './canary.ts';

const CHECKS: CanaryCheck[] = [
  { name: 'landing', path: '/', expectStatus: 200, expectBodyContains: ['Relay'], meaning: 'the front door is down' },
  { name: 'forged token', path: '/api/verify/x', expectStatus: 403, meaning: 'the boundary is open' },
];

function fakeFetch(answers: Record<string, { status: number; body: string } | Error>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const a = answers[path];
    if (!a) throw new Error(`unexpected request ${path}`);
    if (a instanceof Error) throw a;
    return new Response(a.body, { status: a.status });
  }) as typeof fetch;
}

describe('runCanary', () => {
  it('passes when every check gets its expected answer', async () => {
    const run = await runCanary('https://example.test', {
      checks: CHECKS,
      fetchImpl: fakeFetch({ '/': { status: 200, body: 'Relay home' }, '/api/verify/x': { status: 403, body: '' } }),
    });
    expect(run.ok).toBe(true);
    expect(run.failures).toEqual([]);
    expect(run.output).toContain('All 2 checks passed.');
  });

  it('fails, names the check, and keeps the line shape productionKey reads', async () => {
    const run = await runCanary('https://example.test', {
      checks: CHECKS,
      fetchImpl: fakeFetch({ '/': { status: 200, body: 'Relay home' }, '/api/verify/x': { status: 200, body: '' } }),
    });
    expect(run.ok).toBe(false);
    expect(run.failures).toHaveLength(1);
    expect(run.output).toContain('1 of 2 checks FAILED');
    // The alert de-duplicates on this key; if the line shape drifts, every tick looks like a new problem.
    expect(productionKey(run.output)).toBe('forged token');
  });

  it('treats a request that throws as a failed check, not a crash', async () => {
    const run = await runCanary('https://example.test', {
      checks: CHECKS,
      fetchImpl: fakeFetch({ '/': new Error('ECONNRESET'), '/api/verify/x': { status: 403, body: '' } }),
    });
    expect(run.ok).toBe(false);
    expect(run.failures[0]).toMatch(/^landing: request failed/);
    expect(productionKey(run.output)).toBe('landing');
  });

  it('does not follow redirects (a protection wall must not read as a 200)', async () => {
    const seen: RequestInit[] = [];
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response('', { status: 403 });
    }) as typeof fetch;
    await runCanary('https://example.test', { checks: [CHECKS[1]], fetchImpl: f });
    expect(seen[0].redirect).toBe('manual');
  });
});
