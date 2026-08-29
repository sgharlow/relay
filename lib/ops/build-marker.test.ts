/**
 * The build marker has one job, and it is a job a naive implementation fails.
 *
 * The property that matters is NOT "it reports the commit". It is that the
 * fields are captured at MODULE LOAD, so two separately-loaded copies of the
 * module disagree — which is the only way a response body can answer "is the
 * code answering me the code I just built". A marker that reads `process.env`
 * per request would pass a "reports the commit" test and be worthless for the
 * bug it exists for.
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildMarker } from './build-marker';

describe('the marker', () => {
  it('reports a sha, a load time and an instance id', () => {
    const m = buildMarker();

    expect(typeof m.sha).toBe('string');
    expect(m.sha.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(m.loadedAt))).toBe(false);
    expect(m.instance).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is STABLE within one loaded module — it is not per-request state', () => {
    const a = buildMarker();
    const b = buildMarker();

    expect(b.loadedAt).toBe(a.loadedAt);
    expect(b.instance).toBe(a.instance);
    expect(b.sha).toBe(a.sha);
  });

  /*
    A caller spreads this into a JSON response body. If the same object were
    handed out every time, one caller mutating it would change what every later
    caller reports — a shared-mutable-marker bug that would be invisible until
    the day the marker was the evidence.
  */
  it('hands out a fresh object each time, so a caller cannot poison it', () => {
    const a = buildMarker();
    a.sha = 'tampered';

    expect(buildMarker().sha).not.toBe('tampered');
  });
});

describe('THE PROPERTY IT EXISTS FOR — two loads disagree', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('a separately-loaded copy reports a different instance id', async () => {
    const first = (await import('./build-marker')).buildMarker();
    vi.resetModules();
    const second = (await import('./build-marker')).buildMarker();

    expect(second.instance).not.toBe(first.instance);
  });

  /*
    The regression this guards: someone "simplifies" the module by reading
    process.env inside buildMarker(). That version would return the NEW sha from
    an OLD module, which is precisely the false reassurance the nine-delivery
    mystery needed ruled out. Here the env is changed between loads, and the
    already-loaded copy must keep reporting what it was loaded with.
  */
  it('an already-loaded copy does NOT pick up a changed environment', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'aaaaaaaaaaaa1111');
    const loaded = await import('./build-marker');
    expect(loaded.buildMarker().sha).toBe('aaaaaaaaaaaa');

    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'bbbbbbbbbbbb2222');
    expect(loaded.buildMarker().sha).toBe('aaaaaaaaaaaa');
  });
});

describe('where the sha comes from', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('prefers the Vercel variable and truncates it to 12', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef0123456789abcdef01234567');
    vi.stubEnv('RELAY_BUILD_SHA', 'ignored');

    expect((await import('./build-marker')).buildMarker().sha).toBe('0123456789ab');
  });

  /*
    Route 3 of the E1-prime proof runs against a LOCAL production build, where
    VERCEL_GIT_COMMIT_SHA does not exist. Without this fallback the marker would
    read `unknown` in the exact run it was built for.
  */
  it('falls back to RELAY_BUILD_SHA for a local production build', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('RELAY_BUILD_SHA', 'localbuild123456');

    expect((await import('./build-marker')).buildMarker().sha).toBe('localbuild12');
  });

  it('says `unknown` rather than throwing or reporting an empty string', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('RELAY_BUILD_SHA', '');

    expect((await import('./build-marker')).buildMarker().sha).toBe('unknown');
  });
});
