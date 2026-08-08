/**
 * Tests for vault readiness.
 *
 * The case that matters most is the one that shipped: a vault with rules and no
 * verifier. It rendered as complete on every screen and could never open,
 * because a provisioned release state defaults to requiring one confirmation
 * and nothing required a verifier to exist. That must be FATAL, not advisory.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import { assessReadiness } from './readiness';

const mockQuery = vi.mocked(query);

/** Order matches the Promise.all: items, recipients, rules, verifiers, states. */
function setup(o: {
  items?: number;
  recipients?: number;
  rules?: number;
  verifiers?: number;
  states?: Array<{ trigger_type: string; required_confirmations: number }>;
}) {
  const n = (v = 0) => ({ rows: [{ n: String(v) }], rowCount: 1 }) as never;
  mockQuery
    .mockResolvedValueOnce(n(o.items ?? 5))
    .mockResolvedValueOnce(n(o.recipients ?? 1))
    .mockResolvedValueOnce(n(o.rules ?? 1))
    .mockResolvedValueOnce(n(o.verifiers ?? 1))
    .mockResolvedValueOnce({ rows: o.states ?? [{ trigger_type: 'emergency', required_confirmations: 1 }], rowCount: 1 } as never);
}

beforeEach(() => vi.clearAllMocks());

describe('the defect this exists for', () => {
  it('flags a vault with rules and NO verifier as FATAL', async () => {
    setup({ verifiers: 0 });
    const r = await assessReadiness('o-1');

    const blocker = r.blockers.find((b) => b.code === 'no_verifiers');
    expect(blocker).toBeDefined();
    expect(blocker?.fatal).toBe(true);
    expect(r.ready).toBe(false);
  });

  it('says plainly that the vault would not open', async () => {
    setup({ verifiers: 0 });
    const r = await assessReadiness('o-1');
    expect(r.blockers[0].message).toContain('would not open');
  });

  it('flags a threshold no number of existing verifiers could reach', async () => {
    setup({ verifiers: 1, states: [{ trigger_type: 'emergency', required_confirmations: 3 }] });
    const r = await assessReadiness('o-1');

    const blocker = r.blockers.find((b) => b.code === 'not_enough_verifiers');
    expect(blocker?.fatal).toBe(true);
    expect(blocker?.message).toContain('3 confirmations');
  });

  it('does NOT flag verifiers before any trigger is provisioned', async () => {
    // A brand-new account with nothing set up should not be told its vault is
    // broken; it is unbuilt, which is a different message.
    setup({ items: 0, recipients: 0, rules: 0, verifiers: 0, states: [] });
    const r = await assessReadiness('o-1');
    expect(r.blockers.some((b) => b.fatal)).toBe(false);
  });
});

describe('a complete vault', () => {
  it('is ready', async () => {
    setup({});
    await expect(assessReadiness('o-1')).resolves.toMatchObject({ ready: true, blockers: [] });
  });

  it('is ready when verifiers exceed the threshold', async () => {
    setup({ verifiers: 3, states: [{ trigger_type: 'emergency', required_confirmations: 2 }] });
    await expect(assessReadiness('o-1')).resolves.toMatchObject({ ready: true });
  });
});

describe('setup-in-progress blockers are not faults', () => {
  it('reports an empty vault as non-fatal', async () => {
    setup({ items: 0, states: [] });
    const r = await assessReadiness('o-1');
    expect(r.blockers.find((b) => b.code === 'no_items')?.fatal).toBe(false);
  });

  it('reports missing recipients as non-fatal', async () => {
    setup({ recipients: 0, rules: 0, states: [] });
    const r = await assessReadiness('o-1');
    expect(r.blockers.find((b) => b.code === 'no_recipients')?.fatal).toBe(false);
  });

  it('does not nag about rules when there is nobody to write them for', async () => {
    setup({ recipients: 0, rules: 0, states: [] });
    const r = await assessReadiness('o-1');
    expect(r.blockers.some((b) => b.code === 'no_rules')).toBe(false);
  });

  it('every blocker points somewhere the owner can act', async () => {
    setup({ items: 0, recipients: 0, rules: 0, verifiers: 0, states: [] });
    const r = await assessReadiness('o-1');
    for (const b of r.blockers) expect(b.href).toMatch(/^\//);
  });
});
