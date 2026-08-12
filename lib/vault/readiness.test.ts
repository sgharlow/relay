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

/**
 * Order matches the Promise.all: counts, states, then the three rowsets the
 * preparedness statement needs — item metadata, ruled item ids, recipient names.
 */
function setup(o: {
  items?: number;
  recipients?: number;
  rules?: number;
  verifiers?: number;
  states?: Array<{ trigger_type: string; required_confirmations: number }>;
  itemRows?: Array<{ id: string; title: string; criticality: string | null; is_root_credential: boolean }>;
  ruledItemIds?: string[];
  recipientNames?: string[];
  /**
   * Person state, added 2026-08-12 for §4.3 and [A3]. Defaults to every roster
   * row `confirmed`, which reproduces the pre-change behaviour exactly — able
   * count equals roster count — so the tests above keep asserting what they
   * were written to assert.
   */
  verifierStates?: Array<{ id: string; standby_state: string | null }>;
  recipientStates?: Array<{ id: string; standby_state: string | null }>;
}) {
  const n = (v = 0) => ({ rows: [{ n: String(v) }], rowCount: 1 }) as never;
  mockQuery
    .mockResolvedValueOnce(n(o.items ?? 5))
    .mockResolvedValueOnce(n(o.recipients ?? 1))
    .mockResolvedValueOnce(n(o.rules ?? 1))
    .mockResolvedValueOnce(n(o.verifiers ?? 1))
    .mockResolvedValueOnce({ rows: o.states ?? [{ trigger_type: 'emergency', required_confirmations: 1 }], rowCount: 1 } as never)
    .mockResolvedValueOnce({ rows: o.itemRows ?? [], rowCount: 0 } as never)
    .mockResolvedValueOnce({ rows: (o.ruledItemIds ?? []).map((id) => ({ vault_item_id: id })), rowCount: 0 } as never)
    .mockResolvedValueOnce({ rows: (o.recipientNames ?? ['Sarah Chen']).map((name) => ({ name })), rowCount: 1 } as never)
    .mockResolvedValueOnce({
      rows: o.verifierStates ?? confirmedRows(o.verifiers ?? 1, 'v'),
      rowCount: 1,
    } as never)
    .mockResolvedValueOnce({
      rows: o.recipientStates ?? confirmedRows(o.recipients ?? 1, 'r'),
      rowCount: 1,
    } as never);
}

function confirmedRows(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    standby_state: 'confirmed',
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Anything the setup() sequence does not spell out answers EMPTY rather than
  // undefined. The fourth time a positional mock has broken on an unrelated
  // added query — here the [A3] passkey and emergency-code lookups.
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

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

    const blocker = r.blockers.find((b) => b.code === 'unsatisfiable_quorum');
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
    // `fragile_quorum` is expected here and does NOT make a vault un-ready: one
    // confirmed verifier with no passkey and no emergency code is a working plan
    // that rests on a single thread. [A3] ruling, 2026-08-12.
    const r = await assessReadiness('o-1');
    expect(r.ready).toBe(true);
    expect(r.blockers.filter((b) => b.fatal)).toEqual([]);
    expect(r.blockers.map((b) => b.code)).toEqual(['fragile_quorum']);
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

/**
 * Added 2026-08-09 with the standing readiness header.
 *
 * The audit's last open finding was that a preparedness product never states
 * how prepared you are. These pin the statement itself, because it is shown on
 * every owner screen and a wrong number there is worse than no number.
 */
describe('the preparedness statement', () => {
  it('counts only what an access rule can actually open', async () => {
    setup({
      verifiers: 1,
      itemRows: [
        { id: 'a', title: 'Gmail', criticality: 'critical', is_root_credential: true },
        { id: 'b', title: 'Verizon PIN', criticality: 'critical', is_root_credential: false },
      ],
      ruledItemIds: ['a'],
      recipientNames: ['Sarah Chen'],
    });

    const r = await assessReadiness('o-1');

    expect(r.preparedness.reachable).toBe(1);
    expect(r.preparedness.mattering).toBe(2);
    expect(r.preparedness.unreachable).toContain('Verizon PIN');
  });

  it('names the single recipient, because "someone" is what everyone else says', async () => {
    setup({ recipientNames: ['Sarah Chen'] });
    expect((await assessReadiness('o-1')).whoLabel).toBe('Sarah Chen');
  });

  it('falls back when there is more than one person to name', async () => {
    setup({ recipientNames: ['Sarah Chen', 'Tom Chen'] });
    expect((await assessReadiness('o-1')).whoLabel).toBe('the people you named');
  });

  it('says nobody when nobody is named', async () => {
    setup({ recipients: 0, recipientNames: [] });
    expect((await assessReadiness('o-1')).whoLabel).toBe('nobody');
  });

  it('flags a lone verifier as a gap rather than a blocker', async () => {
    // One verifier works — until they are on the same flight as you.
    setup({ verifiers: 1, itemRows: [{ id: 'a', title: 'Gmail', criticality: 'critical', is_root_credential: false }], ruledItemIds: ['a'] });
    const r = await assessReadiness('o-1');
    expect(r.preparedness.gaps).toContain('a second person who can confirm an emergency');
  });
});

describe('§4.3 — a quorum nobody left can satisfy', () => {
  it('counts people who could ANSWER, not roster rows', async () => {
    // The defect: this compared the threshold against the roster count, so two
    // verifiers both REVOKED read as able to give two confirmations. §4.3
    // describes the result exactly — "the release stalls permanently with no
    // error anywhere" — and nothing anywhere said so.
    setup({
      verifiers: 2,
      states: [{ trigger_type: 'emergency', required_confirmations: 2 }],
      verifierStates: [
        { id: 'v-0', standby_state: 'revoked' },
        { id: 'v-1', standby_state: 'revoked' },
      ],
    });

    const r = await assessReadiness('owner-1');

    const blocker = r.blockers.find((b) => b.code === 'unsatisfiable_quorum');
    expect(blocker?.fatal).toBe(true);
    expect(blocker?.message).toContain('verified');
  });

  it('WARNS about people who have not been verified — reversed 2026-08-12', async () => {
    // This test asserted the opposite that morning, and the reversal is
    // deliberate rather than a correction. The reasoning then was that a fatal
    // warning must not be untrue for a plan that would in fact run: a
    // claimed-but-unconfirmed verifier could still answer and their answer
    // counted. §4.3 changed the second half — an unverified answer is now
    // recorded and does NOT advance the quorum — so the plan genuinely cannot
    // complete and saying so is accurate.
    //
    // The principle did not move. What moved was the truth it was applied to.
    setup({
      verifiers: 2,
      states: [{ trigger_type: 'emergency', required_confirmations: 2 }],
      verifierStates: [
        { id: 'v-0', standby_state: 'invited' },
        { id: 'v-1', standby_state: 'claimed' },
      ],
    });

    const r = await assessReadiness('owner-1');

    const blocker = r.blockers.find((b) => b.code === 'unsatisfiable_quorum');
    expect(blocker?.fatal).toBe(true);
    // Points at the circle, not at /triggers: the fix is a phone call, not a
    // lower threshold.
    expect(blocker?.href).toBe('/circle');
    expect(blocker?.message).toContain('really them');
  });

  it('fires when a resignation drops the pool below the threshold', async () => {
    // The path that made this newly reachable: three ways to remove a
    // participant shipped on 2026-08-12 where before there was one.
    setup({
      verifiers: 2,
      states: [{ trigger_type: 'emergency', required_confirmations: 2 }],
      verifierStates: [
        { id: 'v-0', standby_state: 'confirmed' },
        { id: 'v-1', standby_state: 'revoked' },
      ],
    });

    const r = await assessReadiness('owner-1');

    expect(r.blockers.some((b) => b.code === 'unsatisfiable_quorum' && b.fatal)).toBe(true);
  });
});

describe('[A3] — the light reports something at last', () => {
  it('is GREEN only when the plan can actually run', async () => {
    setup({
      verifiers: 1,
      recipients: 1,
      states: [{ trigger_type: 'emergency', required_confirmations: 1 }],
    });

    const r = await assessReadiness('owner-1');

    expect(r.circle.light).toBe('green');
    expect(r.circle.executable).toBe(true);
    expect(r.circle.nextAction).toBeNull();
  });

  it('is AMBER with a confirmed verifier but nobody able to receive', async () => {
    setup({
      verifiers: 1,
      recipients: 1,
      states: [{ trigger_type: 'emergency', required_confirmations: 1 }],
      recipientStates: [{ id: 'r-0', standby_state: 'claimed' }],
    });

    const r = await assessReadiness('owner-1');

    expect(r.circle.light).toBe('amber');
    expect(r.circle.executable).toBe(false);
    // Not just a colour — §4.5 requires the single fastest next action.
    expect(r.circle.nextAction).toContain('Confirm a recipient');
  });

  it('is RED when nobody has claimed at all', async () => {
    setup({
      verifiers: 1,
      recipients: 1,
      states: [{ trigger_type: 'emergency', required_confirmations: 1 }],
      verifierStates: [{ id: 'v-0', standby_state: 'invited' }],
      recipientStates: [{ id: 'r-0', standby_state: 'invited' }],
    });

    const r = await assessReadiness('owner-1');

    expect(r.circle.light).toBe('red');
    expect(r.circle.nextAction).toBeTruthy();
  });
});

describe('[A3] fragility — ruled 2026-08-12', () => {
  it('warns when the plan rests on somebody with no way back in', async () => {
    // The audit case: green and executable, and the only counting verifier had
    // neither a passkey nor an emergency code, so the plan worked for exactly as
    // long as they kept hold of their phone.
    setup({ verifiers: 1, states: [{ trigger_type: 'emergency', required_confirmations: 1 }] });

    const r = await assessReadiness('o-1');
    const f = r.blockers.find((b) => b.code === 'fragile_quorum');

    expect(f).toBeDefined();
    expect(f?.fatal).toBe(false);
    expect(f?.message).toContain('no way back in');
  });

  it('does NOT make the vault un-ready — it works today', async () => {
    setup({ verifiers: 1, states: [{ trigger_type: 'emergency', required_confirmations: 1 }] });
    await expect(assessReadiness('o-1')).resolves.toMatchObject({ ready: true });
  });

  it('stays quiet when the quorum has slack', async () => {
    // Two confirmed verifiers for a threshold of one: losing a device is
    // survivable, and saying otherwise is the nagging §4.5 rejects.
    setup({
      verifiers: 2,
      states: [{ trigger_type: 'emergency', required_confirmations: 1 }],
      verifierStates: [
        { id: 'v-0', standby_state: 'confirmed' },
        { id: 'v-1', standby_state: 'confirmed' },
      ],
    });

    const r = await assessReadiness('o-1');
    expect(r.blockers.find((b) => b.code === 'fragile_quorum')).toBeUndefined();
  });

  it('never competes with a FATAL blocker', async () => {
    // Two urgent paragraphs is how a banner becomes wallpaper. If the plan
    // cannot run at all, that is the thing to say.
    setup({
      verifiers: 1,
      states: [{ trigger_type: 'emergency', required_confirmations: 2 }],
      verifierStates: [{ id: 'v-0', standby_state: 'confirmed' }],
    });

    const r = await assessReadiness('o-1');
    expect(r.blockers.some((b) => b.fatal)).toBe(true);
    expect(r.blockers.find((b) => b.code === 'fragile_quorum')).toBeUndefined();
  });
});

describe('🔴 the standing sentence counts ABLE verifiers — found by writing the user manual', () => {
  it('does not call a plan ready when its only verifier is named but not verified', async () => {
    // `verifierCount` was `SELECT count(*) FROM verifiers` -- any state -- so
    // `ready` went true on the strength of somebody having been TYPED IN. Full
    // coverage plus one unverified verifier produced a sage "could reach all N
    // of the things that matter" stacked directly above the clay "This vault
    // would not open in an emergency."
    //
    // Third occurrence of the same NAMED-vs-ABLE confusion producing a wrong
    // colour, one level further out each time.
    setup({
      items: 1,
      verifiers: 1,
      itemRows: [{ id: 'i-1', title: 'Gmail', criticality: 'critical', is_root_credential: true }],
      ruledItemIds: ['i-1'],
      verifierStates: [{ id: 'v-0', standby_state: 'invited' }],
    });

    const r = await assessReadiness('o-1');
    expect(r.preparedness.ready).toBe(false);
    // ...and the fatal blocker that contradicted it is still raised.
    expect(r.blockers.some((b) => b.fatal)).toBe(true);
  });

  it('is ready when the same plan has a VERIFIED verifier', async () => {
    setup({
      items: 1,
      verifiers: 1,
      itemRows: [{ id: 'i-1', title: 'Gmail', criticality: 'critical', is_root_credential: true }],
      ruledItemIds: ['i-1'],
      verifierStates: [{ id: 'v-0', standby_state: 'confirmed' }],
    });

    const r = await assessReadiness('o-1');
    expect(r.preparedness.ready).toBe(true);
    expect(r.blockers.filter((b) => b.fatal)).toEqual([]);
  });

  it('a break-glass-only verifier does not make a plan ready either', async () => {
    // §8.1's documented exclusion: they will never count, and the sentence must
    // not imply otherwise.
    setup({
      items: 1,
      verifiers: 1,
      itemRows: [{ id: 'i-1', title: 'Gmail', criticality: 'critical', is_root_credential: true }],
      ruledItemIds: ['i-1'],
      verifierStates: [{ id: 'v-0', standby_state: 'invited' }],
    });

    const r = await assessReadiness('o-1');
    expect(r.preparedness.ready).toBe(false);
  });
});
