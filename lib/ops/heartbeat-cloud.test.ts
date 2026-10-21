/**
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */
import { describe, it, expect } from 'vitest';
import {
  cloudHeartbeat,
  githubRest,
  schedulerMonitorDue,
  SCHEDULER_MONITOR_FILE,
  type CloudHeartbeatDeps,
  type GitHubPort,
} from './heartbeat-cloud.ts';
import { CANARY_FILE } from './cadence-wall.ts';
import { DEFAULT_POLICY } from './heartbeat-alert.ts';

const CFG = { baseUrl: 'https://relaystandby.com', windowHours: 6, minRuns: 1, policy: DEFAULT_POLICY };
const AT = new Date('2026-10-21T06:00:00Z');
const recentRun = { event: 'workflow_dispatch', created_at: '2026-10-21T05:45:00Z' };

function world(over: Partial<CloudHeartbeatDeps> & { runs?: unknown[] } = {}) {
  const dispatched: string[] = [];
  const mails: { subject: string; text: string }[] = [];
  let saved: string | null | undefined; // undefined = never saved
  const github: GitHubPort = {
    listCanaryRuns: async () => (over.runs ?? [recentRun]) as never,
    dispatch: async (f) => {
      dispatched.push(f);
    },
  };
  const deps: CloudHeartbeatDeps = {
    now: () => AT,
    canary: async () => ({ ok: true, output: 'All 8 checks passed.' }),
    github,
    loadState: async () => null,
    saveState: async (raw) => {
      saved = raw;
    },
    send: async (subject, text) => {
      mails.push({ subject, text });
      return true;
    },
    ...over,
  };
  return { deps, dispatched, mails, saved: () => saved };
}

const failingCanary = async () => ({ ok: false, output: '  ✗ landing page serves — expected HTTP 200, got 500\n' });

describe('schedulerMonitorDue', () => {
  it('is due on two of the four quarter-hours, the same rule the VICTUS task used', () => {
    const due = [0, 15, 30, 45].map((m) => schedulerMonitorDue(new Date(Date.UTC(2026, 9, 21, 6, m))));
    expect(due).toEqual([true, false, true, false]);
    expect(schedulerMonitorDue(new Date(Date.UTC(2026, 9, 21, 6, 44)))).toBe(true);
    expect(schedulerMonitorDue(new Date(Date.UTC(2026, 9, 21, 6, 14, 59)))).toBe(true);
  });
});

describe('cloudHeartbeat', () => {
  it('healthy: dispatches both workflows on a due tick, sends nothing', async () => {
    const w = world();
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.result).toBe('ok');
    expect(w.dispatched).toEqual([CANARY_FILE, SCHEDULER_MONITOR_FILE]);
    expect(r.dispatch).toEqual({ canary: 'ok', schedulerMonitor: 'ok' });
    expect(w.mails).toHaveLength(0);
  });

  it('skips the scheduler monitor on an off tick', async () => {
    const w = world({ now: () => new Date('2026-10-21T06:15:00Z') });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(w.dispatched).toEqual([CANARY_FILE]);
    expect(r.dispatch.schedulerMonitor).toBe('skipped');
  });

  it('production failing: one alert, state persisted, and the same problem is NOT re-mailed next tick', async () => {
    const w = world({ canary: failingCanary });
    const first = await cloudHeartbeat(w.deps, CFG);
    expect(first.result).toBe('finding');
    expect(first.halves).toEqual(['production']);
    expect(first.alerted).toBe(true);
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0].subject).toMatch(/production FAILING/);
    const stored = w.saved();
    expect(typeof stored).toBe('string');

    // Next tick reads back what the first wrote.
    const w2 = world({ canary: failingCanary, loadState: async () => stored as string, now: () => new Date(AT.getTime() + 15 * 60_000) });
    const second = await cloudHeartbeat(w2.deps, CFG);
    expect(second.result).toBe('finding');
    expect(w2.mails).toHaveLength(0);
  });

  it('the alert names the Lambda as its sender, not the operator machine (drill mail 2026-10-21)', async () => {
    const w = world({ canary: failingCanary });
    await cloudHeartbeat(w.deps, CFG);
    expect(w.mails[0].text).toMatch(/AWS Lambda relay-heartbeat/);
    expect(w.mails[0].text).not.toMatch(/LOCAL watchdog/);
  });

  it('the production detail starts at the failure list, so the FIRST failure is never cut (drill mail 2026-10-21)', async () => {
    const passes = Array.from({ length: 40 }, (_, i) => `  ✓ check ${i} — HTTP 200 and a long passing line to pad the output out`).join('\n');
    const failures = Array.from({ length: 8 }, (_, i) => `  • failing check ${i}: expected HTTP 200, got 404\n    ${'consequence text '.repeat(8)}`).join('\n');
    const output = `canary → x\n\n${passes}\n  ✗ failing check 0 — expected HTTP 200, got 404\n\n8 of 48 checks FAILED:\n\n${failures}\n`;
    const w = world({ canary: async () => ({ ok: false, output }) });
    await cloudHeartbeat(w.deps, CFG);
    expect(w.mails[0].text).toMatch(/8 of 48 checks FAILED:\n\n {2}• failing check 0:/);
    expect(w.mails[0].text).toMatch(/• failing check 7:/);
  });

  it('delivery stopped: no counted run in the window is a finding', async () => {
    const w = world({ runs: [{ event: 'push', created_at: '2026-10-21T05:50:00Z' }, { event: 'schedule', created_at: '2026-10-20T20:00:00Z' }] });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.result).toBe('finding');
    expect(r.halves).toEqual(['delivery']);
    expect(w.mails[0].text).toMatch(/0 canary run/);
  });

  it('cannot read GitHub and production healthy: could-not-look, and no mail', async () => {
    const w = world({ github: { listCanaryRuns: async () => { throw new Error('401'); }, dispatch: async () => {} } });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.result).toBe('could-not-look');
    expect(r.why).toMatch(/401/);
    expect(w.mails).toHaveLength(0);
  });

  it('a failed dispatch is reported but does not stop the probes', async () => {
    const w = world({
      canary: failingCanary,
      github: { listCanaryRuns: async () => [recentRun], dispatch: async () => { throw new Error('HTTP 422'); } },
    });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.dispatch.canary).toMatch(/^failed: .*422/);
    expect(r.result).toBe('finding');
    expect(w.mails).toHaveLength(1);
  });

  it('an unreadable stored state fails OPEN (alerts) rather than going quiet', async () => {
    const w = world({ canary: failingCanary, loadState: async () => '{not json' });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.alerted).toBe(true);
  });

  it('a state store that cannot be read at all still alerts', async () => {
    const w = world({ canary: failingCanary, loadState: async () => { throw new Error('S3 AccessDenied'); } });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.alerted).toBe(true);
  });

  it('a state save failure is reported, never thrown', async () => {
    const w = world({ canary: failingCanary, saveState: async () => { throw new Error('S3 down'); } });
    const r = await cloudHeartbeat(w.deps, CFG);
    expect(r.alerted).toBe(true);
    expect(r.stateError).toMatch(/S3 down/);
  });
});

describe('githubRest', () => {
  function recorder(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (u: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(u), init: init ?? {} });
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    }) as typeof fetch;
    return { calls, f };
  }

  it('dispatches on the default branch with the token', async () => {
    const r = recorder(204, null);
    await githubRest({ token: 't0k', repo: 'sgharlow/relay', fetchImpl: r.f }).dispatch(CANARY_FILE);
    expect(r.calls[0].url).toBe(`https://api.github.com/repos/sgharlow/relay/actions/workflows/${CANARY_FILE}/dispatches`);
    expect(r.calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ ref: 'master' });
    expect((r.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer t0k');
  });

  it('a refused dispatch throws with the status', async () => {
    const r = recorder(403, { message: 'Resource not accessible by personal access token' });
    await expect(githubRest({ token: 't', repo: 'a/b', fetchImpl: r.f }).dispatch(CANARY_FILE)).rejects.toThrow(/403/);
  });

  it('lists the canary runs, projected to event + created_at', async () => {
    const r = recorder(200, { workflow_runs: [{ event: 'schedule', created_at: 'x', id: 1, name: 'n' }] });
    const runs = await githubRest({ token: 't', repo: 'a/b', fetchImpl: r.f }).listCanaryRuns();
    expect(r.calls[0].url).toBe(`https://api.github.com/repos/a/b/actions/workflows/${CANARY_FILE}/runs?per_page=100`);
    expect(runs).toEqual([{ event: 'schedule', created_at: 'x' }]);
  });

  it('an unreadable run list throws (cannot look is not healthy)', async () => {
    const r = recorder(200, { nope: true });
    await expect(githubRest({ token: 't', repo: 'a/b', fetchImpl: r.f }).listCanaryRuns()).rejects.toThrow(/unreadable/);
    const r2 = recorder(500, {});
    await expect(githubRest({ token: 't', repo: 'a/b', fetchImpl: r2.f }).listCanaryRuns()).rejects.toThrow(/500/);
  });
});
