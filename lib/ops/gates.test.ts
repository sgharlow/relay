/**
 * A gate cannot slide quietly, and the beta flag cannot move alone.
 *
 * 🔴 THE PORTFOLIO'S OLDEST FAILURE MODE, and PROJECT.yaml says so itself:
 * "A gate that slides quietly is how this portfolio accumulates past-due-
 * undecided gates." It says that in a COMMENT, next to the one gate that has
 * already moved once. A comment cannot stop the next one.
 *
 * These two checks are the Phase 3 half of the pre-release audit that could
 * actually be built. The decisions themselves — counsel, pricing, when beta
 * ends — are not engineering questions and no commit closes them. What
 * engineering can do is make sure nobody finds out late.
 *
 * ⚠️ THIS TEST IS DESIGNED TO GO RED ON A DATE, WITH NO CODE CHANGE. That is
 * the entire point, and it is not a bug when it happens. There are exactly two
 * honest ways to make it green again, both already demonstrated in the file it
 * reads: record what was decided (`met:`), or move the date with a reason and a
 * derivation (`moved:`), the way g1-caregiver-wtp was moved on 2026-08-11.
 * Deleting the gate is the third way and the reason this message is long.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TIER_LIMITS } from '../billing/entitlements';

const PROJECT = readFileSync('PROJECT.yaml', 'utf8');

interface Gate {
  id: string;
  due: string | null;
  decided: boolean;
}

/**
 * The `gates:` blocks, read textually.
 *
 * No YAML dependency added for this: the shape is regular, adding a parser to
 * the production dependency tree for one test is a poor trade, and a textual
 * read that errs toward "this gate looks undecided" fails in the safe
 * direction — somebody investigates, rather than a gate quietly passing.
 */
function gates(): Gate[] {
  const section = /^gates:\n([\s\S]*?)\n(?=[a-z_]+:)/m.exec(PROJECT);
  if (!section) throw new Error('PROJECT.yaml has no gates: section — that is itself the finding');

  return section[1]
    .split(/^\s{2}- id:\s*/m)
    .slice(1)
    .map((block) => {
      const id = block.split('\n')[0].trim();
      const due = /^\s{4}due:\s*(\d{4}-\d{2}-\d{2})/m.exec(block)?.[1] ?? null;
      // `met:` records an outcome. `moved:` records a deliberate, reasoned
      // change of date — both are decisions; neither is a slide.
      const decided = /^\s{4}met:/m.test(block);
      return { id, due, decided };
    });
}

describe('gates', () => {
  it('PROJECT.yaml still declares gates in a shape this can read', () => {
    const g = gates();
    expect(g.length, 'no gates parsed — the format changed and this check went blind').toBeGreaterThan(0);
    for (const gate of g) expect(gate.id).toMatch(/^[a-z0-9-]+$/);
  });

  /*
    The check itself. `due` is read from the file rather than from a constant so
    a moved date takes effect the moment it is written down — which is the only
    way moving a date and recording why can be the same act.
  */
  it('no gate is past due without a recorded decision', () => {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = gates().filter((g) => !g.decided && g.due && g.due < today);

    expect(
      overdue.map((g) => `${g.id} (due ${g.due})`),
      overdue.length
        ? 'These gates passed their due date with nothing recorded:\n' +
          overdue.map((g) => `  ${g.id} — due ${g.due}`).join('\n') +
          '\n\nThis test is doing its job, not failing. Two honest fixes, both ' +
          'already demonstrated in PROJECT.yaml:\n' +
          '  1. Record the outcome under `met:` — what happened, and what follows.\n' +
          '  2. Move `due:` and add a `moved:` block with who moved it and the ' +
          'derivation, as g1-caregiver-wtp did on 2026-08-11.\n\n' +
          'What this exists to prevent is the third option, which is nothing at all.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    An unmet gate the product could WALK PAST is worse than a late one. J10 is
    gated on g2-counsel-opinion, and the enforcement is a single list — so this
    asserts the two agree while counsel is outstanding.
  */
  it('estate stays closed while g2-counsel-opinion is undecided', () => {
    const g2 = gates().find((g) => g.id === 'g2-counsel-opinion');
    if (!g2 || g2.decided) return; // counsel came back; enabling it is a decision.

    const enums = readFileSync('lib/domain/enums.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const selectable = /USER_SELECTABLE_TRIGGER_TYPES[^=]*=\s*\[([^\]]*)\]/.exec(enums)?.[1] ?? '';
    expect(
      selectable.includes('estate'),
      'estate is user-selectable while g2-counsel-opinion is still open. That gate ' +
        'says counsel is REQUIRED before any paying estate customer, and Stripe is ' +
        'live — so the first person to use it is exactly the case the gate exists ' +
        'for. Re-enable it in the same change that records the counsel opinion.',
    ).toBe(false);
  });
});

/**
 * 🔴 ONE DECISION, THREE ARTIFACTS THAT MUST MOVE TOGETHER.
 *
 * `TIER_LIMITS.free.canRelease` is true during beta so founding families —
 * onboarded by hand, none of whom have paid — can exercise the one capability
 * the product exists for. Flipping it touches three things:
 *
 *   1. the flag itself
 *   2. §2.7 of the user guide, which promises the free limits "apply only to
 *      adding more" — already guarded by lib/billing/beta-flag.test.ts
 *   3. the SKIPPED test in lib/billing/entitlements.test.ts, which is skipped
 *      *because* the flag is true and asserts the opposite
 *
 * The audit found the third one carrying no owner and no date, and beta-flag
 * only ever watched the first two. A skipped test is the easiest of the three
 * to forget, because nothing goes red when it stays skipped — it just quietly
 * stops being an assertion about anything.
 */
describe('the beta release flag moves with everything it implies', () => {
  const ENTITLEMENTS_TEST = 'lib/billing/entitlements.test.ts';

  it('the skipped paywall test is skipped only while the paywall is off', () => {
    const src = readFileSync(ENTITLEMENTS_TEST, 'utf8');
    const skipped = /it\.skip\(\s*['"]blocks release on free/.test(src);

    if (TIER_LIMITS.free.canRelease) {
      expect(
        skipped,
        'The free tier CAN release, so the test asserting it cannot is correctly ' +
          'skipped. Nothing to do — this branch records the current state.',
      ).toBe(true);
      return;
    }

    expect(
      skipped,
      'canRelease is now false — the beta paywall is ON — but the test asserting ' +
        `that a free account is blocked is still skipped in ${ENTITLEMENTS_TEST}. ` +
        'Un-skip it: it is the only thing that would notice the paywall silently ' +
        'not working. Its own comment already says "re-enable when the beta ' +
        'paywall is turned on".',
    ).toBe(false);
  });

  /*
    And the decision has to stay a dated, owned one. An undated temporary flag
    is a permanent flag nobody has admitted to — PROJECT.yaml's own words.
  */
  it('the decision is still recorded with an owner and a revisit date', () => {
    const block = /- id: beta-free-release\n([\s\S]*?)(?=\n  - id: |\n[a-z_]+:)/.exec(PROJECT)?.[1];
    expect(block, 'the beta-free-release decision has vanished from PROJECT.yaml').toBeDefined();
    expect(block).toMatch(/owner:\s*\S+/);
    expect(block).toMatch(/revisit:/);
  });
});
