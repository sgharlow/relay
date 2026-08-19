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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TIER_LIMITS } from '../billing/entitlements';

const PROJECT = readFileSync('PROJECT.yaml', 'utf8');

/** Every source file a developer would read to decide what to build. */
function walkSource(dirs = ['src', 'lib'], out: string[] = []): string[] {
  for (const dir of dirs) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry).split(String.fromCharCode(92)).join('/');
      if (statSync(p).isDirectory()) walkSource([p], out);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
  }
  return out;
}

/**
 * What has been recorded about a gate's outcome.
 *
 * 🔴 THIS WAS A BOOLEAN AND THE BOOLEAN WAS BACKWARDS, corrected 2026-08-14.
 * `decided` collapsed two opposite outcomes into one value, and the estate check
 * below returned early on it — so recording the decision NOT to seek counsel
 * would have RELEASED the lock that decision exists to make permanent. The
 * safest possible answer would have unlocked the riskiest possible capability.
 *
 *   open     — nothing recorded yet. Estate stays shut, and the clock runs.
 *   met      — the gate's own condition was satisfied. For g2 that is a written
 *              counsel opinion, after which enabling estate is a legitimate
 *              deliberate act and this file stops having an opinion about it.
 *   declined — we will not pursue the condition, ever. The gated capability is
 *              therefore closed PERMANENTLY, not pending. This is the strongest
 *              lock in the file, not the absence of one.
 */
type Disposition = 'open' | 'met' | 'declined';

interface Gate {
  id: string;
  due: string | null;
  disposition: Disposition;
  /** Drafted, not agreed — carries `status: PROPOSED` and owes a ratification. */
  proposed: boolean;
  /** The date a PROPOSED gate owes an answer by. Earlier than `due` by design. */
  ratifyBy: string | null;
  /** The recorded block body, so a declined gate can be held to its own terms. */
  block: string;
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

      /*
        A PROPOSED gate is a draft: real metric, real target, real owner, and
        nobody has said yes. `ratify_by:` is the date that draft owes an answer,
        and it is EARLIER than `due:` on purpose — g3-b2b2c-pilot-loi is proposed
        with ratify_by 2026-09-01 and due 2026-11-30, so a three-month window
        existed in which the lane was neither ratified nor overdue and nothing
        would have said a word. `due:` was the only date read here.
      */
      const proposed = /^\s{4}status:\s*["']?PROPOSED/m.test(block);
      const ratifyBy = /^\s{4}ratify_by:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(block)?.[1] ?? null;

      /*
        `met:` and `declined:` are both outcomes and both stop the clock — one
        says the condition was satisfied, the other says it will never be
        pursued. `moved:` is deliberately NOT an outcome: moving a date with a
        recorded reason is a legitimate act, but the gate is still open and
        still owes an answer.
      */
      const disposition: Disposition = /^\s{4}met:/m.test(block)
        ? 'met'
        : /^\s{4}declined:/m.test(block)
          ? 'declined'
          : 'open';

      return { id, due, disposition, proposed, ratifyBy, block };
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
    const overdue = gates().filter((g) => g.disposition === 'open' && g.due && g.due < today);

    expect(
      overdue.map((g) => `${g.id} (due ${g.due})`),
      overdue.length
        ? 'These gates passed their due date with nothing recorded:\n' +
          overdue.map((g) => `  ${g.id} — due ${g.due}`).join('\n') +
          '\n\nThis test is doing its job, not failing. Two honest fixes, both ' +
          'already demonstrated in PROJECT.yaml:\n' +
          '  1. Record the outcome under `met:` — what happened, and what follows.\n' +
          '  2. Move `due:` and add a `moved:` block with who moved it and the ' +
          'derivation, as g1-caregiver-wtp did on 2026-08-11.\n' +
          '  3. Record a `declined:` block — the condition will never be pursued, ' +
          'and the capability it gated closes permanently.\n\n' +
          'What this exists to prevent is the fourth option, which is nothing at all.'
        : 'ok',
    ).toEqual([]);
  });

  /**
   * The same rule one level up: a gate that was never AGREED cannot slide either.
   *
   * 🔴 THE GAP THIS CLOSES, found 2026-08-18 by reading the file against itself.
   * `g3-b2b2c-pilot-loi` was drafted with `status: PROPOSED`, `ratify_by:
   * 2026-09-01` and `due: 2026-11-30`, and its own text claims the enforcement:
   * *"If this is still unratified on 2026-11-30, lib/ops/gates.test.ts fails the
   * suite and forces the decision."* True — but only on 11-30, because `due:`
   * was the only date this file read. The ratify-by it also declares bought
   * nothing, and a PROPOSED gate could sit unanswered for three months with
   * every check green.
   *
   * That is the section header's own complaint arrived at from the other side:
   * "A dead precondition does not stop work; it stops work being SCHEDULED,
   * silently, which is worse." A proposal nobody rules on is indistinguishable
   * from the silence it was written to end.
   *
   * Green again by: removing `status: PROPOSED` when it is ratified, moving
   * `ratify_by:` with a reason, or recording `declined:`.
   */
  it('no PROPOSED gate is past its ratify_by without being ratified', () => {
    const today = new Date().toISOString().slice(0, 10);
    const unratified = gates().filter(
      (g) => g.proposed && g.ratifyBy && g.ratifyBy < today && g.disposition === 'open',
    );

    expect(
      unratified.map((g) => `${g.id} (ratify_by ${g.ratifyBy})`),
      unratified.length
        ? 'These gates are still marked PROPOSED past the date they said they would be ' +
          'ruled on:\n' +
          unratified.map((g) => `  ${g.id} — ratify_by ${g.ratifyBy}`).join('\n') +
          '\n\nA proposed gate is a lane with no schedule. Three honest fixes:\n' +
          '  1. Ratified — delete the `status: PROPOSED` line. The gate is now live and its ' +
          '     `due:` date takes over.\n' +
          '  2. Not yet — move `ratify_by:` and say who moved it and why, the way ' +
          '     g1-caregiver-wtp moved its `due:` twice.\n' +
          '  3. Rejected — record a `declined:` block. The lane closes, and that is a result.\n\n' +
          'What this exists to prevent is the fourth option, which is nothing at all.'
        : 'ok',
    ).toEqual([]);
  });

  /**
   * A gate that names a document must still be able to find it.
   *
   * The failure this prevents is dull and common: research gets done, lands in a
   * file, the file is never referenced from the thing it was for, and the next
   * session starts the same work from a blank page. `g1-outlet-dossier.md`
   * avoided it by being cited from the lane doc; this does the same for the
   * partner dossier, mechanically.
   */
  it('every document a gate points at exists', () => {
    const missing: string[] = [];
    for (const gate of gates()) {
      for (const [, path] of gate.block.matchAll(/`?(docs\/[a-z0-9-]+\.md)`?/g)) {
        if (!existsSync(path)) missing.push(`${gate.id} -> ${path}`);
      }
    }
    expect(
      missing,
      missing.length
        ? 'A gate cites a document that is not in the repo:\n' +
          missing.map((m) => `  ${m}`).join('\n') +
          '\n\nEither the file was renamed and the gate was not updated, or it was never ' +
          'committed. Both leave the gate pointing at nothing.'
        : 'ok',
    ).toEqual([]);
  });

  /**
   * The positive control for the check above. Without a PROPOSED gate carrying a
   * ratify_by, that filter is empty for a reason that has nothing to do with
   * anybody having decided anything — and it would keep passing after the field
   * was renamed, misspelt, or dropped from the file entirely.
   */
  it('the parser can still see a PROPOSED gate and its ratify_by', () => {
    const proposals = gates().filter((g) => g.proposed);
    if (!proposals.length) return; // nothing proposed right now — legitimately nothing to see

    for (const p of proposals) {
      expect(
        p.ratifyBy,
        `${p.id} is PROPOSED but declares no ratify_by, so nothing dates the decision. ` +
          'Add one, or do not mark it proposed.',
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * 🔴 THE INVERSION. This check used to return early the moment g2 was
   * "decided", on the reasoning that counsel coming back makes enabling estate a
   * legitimate act. That is true of exactly ONE outcome.
   *
   * The other outcome is declining counsel — and under that outcome estate is
   * closed FOREVER, because the condition that would ever have opened it is
   * never going to be met. Treating the two the same meant the decision to be
   * maximally cautious would have unlocked the capability it was cautious about.
   *
   * So: `met` lifts the lock, `declined` welds it shut, `open` holds it.
   */
  describe('estate stays out of the product', () => {
    const enums = () =>
      readFileSync('lib/domain/enums.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const selectable = () =>
      /USER_SELECTABLE_TRIGGER_TYPES[^=]*=\s*\[([^\]]*)\]/.exec(enums())?.[1] ?? '';

    it('while g2-counsel-opinion is open, or permanently if it was declined', () => {
      const g2 = gates().find((g) => g.id === 'g2-counsel-opinion');
      expect(g2, 'g2-counsel-opinion has vanished from PROJECT.yaml').toBeDefined();
      if (g2!.disposition === 'met') return; // A written opinion exists; enabling is now a decision.

      const permanent = g2!.disposition === 'declined';
      expect(
        selectable().includes('estate'),
        permanent
          ? 'estate is user-selectable, but g2-counsel-opinion was DECLINED — no ' +
            'counsel opinion is coming, so the condition that would have opened ' +
            'this can never be met. This is not "not yet"; it is closed. ' +
            'Re-opening it means reversing the declined decision in PROJECT.yaml ' +
            'first, in its own change, with its own argument.'
          : 'estate is user-selectable while g2-counsel-opinion is still open. That ' +
            'gate says counsel is REQUIRED before any paying estate customer, and ' +
            'Stripe is live — so the first person to use it is exactly the case ' +
            'the gate exists for.',
      ).toBe(false);
    });

    /*
      A declined gate has to stay an ACCEPTED risk rather than a forgotten one.
      Same discipline PROJECT.yaml already applies to beta-free-release: a
      decision with no named risk and no re-trigger is a decision nobody will
      revisit, which is how "we decided not to" becomes "nobody remembers why".
    */
    it('a declined gate names its residual risk and what would reopen it', () => {
      for (const g of gates().filter((x) => x.disposition === 'declined')) {
        expect(g.block, `${g.id} declines without naming the risk it accepts`).toMatch(
          /residual_risk:/,
        );
        expect(g.block, `${g.id} declines without saying what would reopen it`).toMatch(
          /revisit:/,
        );
      }
    });

    /*
      🔴 AND THE CODE MUST NOT PROMISE A DOOR THAT NO LONGER EXISTS. enums.ts
      carried "TO RE-ENABLE once counsel clears" — accurate while the gate was
      open, and actively misleading once counsel is declined. A future reader
      following that instruction would be enabling a permanently-closed
      capability believing they were completing a plan.
    */
    /*
      ⚠️ THE FIRST VERSION OF THIS CHECK WAS A NEGATIVE REGEX OVER PROSE, and it
      failed on the very comment that fixed the problem — the sentence explaining
      that enums.ts USED TO say "pending counsel" contains the words "pending
      counsel". Third time this class has bitten in one working session
      (api-reachability's module specifiers, code-entropy's failed_attempts, this),
      so it is worth stating as a rule: a guard that greps prose will match prose
      ABOUT itself, and the fix is to assert what must be PRESENT rather than
      hunting for what must be absent.

      So the positive assertion carries the weight: enums.ts must name the gate
      and its disposition, which is only true if somebody updated it deliberately.
      The negative is kept but narrowed to the imperative form — an instruction
      telling a future reader to go and re-enable, which is the actual hazard.
    */
    /*
      🔴 THE DRIFT THIS SESSION ACTUALLY FOUND. Declining the gate left ELEVEN
      files across routes, pages, fixtures and tests still describing estate as
      "pending", "gated on counsel", or re-enabled "once counsel clears" — each
      of them an instruction to a future reader to finish a plan that has been
      cancelled. Fixing them by hand once does not stop the twelfth being written
      next month by somebody reading the eleventh.

      Scoped to src/ and lib/ deliberately: those are what a developer reads to
      decide what to build. The record files — PROJECT.yaml's superseded ratified
      entry, the parked counsel brief, the journeys document — legitimately
      QUOTE the old language under their own supersession banners, and rewriting
      history to satisfy a grep would be worse than the drift.
    */
    it('no code or copy still describes estate as pending', () => {
      const g2 = gates().find((g) => g.id === 'g2-counsel-opinion');
      if (g2?.disposition !== 'declined') return;

      const FORWARD_LOOKING = [
        /pending\s+`?g2-counsel-opinion/i,
        /gated\s+on\s+`?g2-counsel-opinion/i,
        /gated\s+on\s+counsel/i,
        /once\s+counsel\s+clears/i,
        /when\s+counsel\s+clears/i,
        /counsel\s+review\s+is\s+pending/i,
      ];

      const offenders: string[] = [];
      for (const file of walkSource()) {
        // This file names the phrases as data; it must not accuse itself.
        if (file.endsWith('lib/ops/gates.test.ts')) continue;
        const src = readFileSync(file, 'utf8');
        for (const re of FORWARD_LOOKING) {
          const m = re.exec(src);
          if (m) offenders.push(`${file}: “${m[0]}”`);
        }
      }

      expect(
        offenders,
        offenders.length
          ? 'These describe estate as waiting on a counsel opinion that was ' +
            'DECLINED and is not coming:\n' +
            offenders.map((o) => `  ${o}`).join('\n') +
            '\n\nSay withdrawn/permanent instead. A comment that tells the next ' +
            'reader to re-enable something once counsel clears is an instruction ' +
            'to complete a cancelled plan.'
          : 'ok',
      ).toEqual([]);
    });

    /*
      🔴 THE THIRD DOOR — served metadata. opengraph-image.tsx scrubbed the
      share card on 2026-08-14 and /caregivers overrides its own og copy, but
      the root layout's SITE_DESCRIPTION — inherited by every page that does
      not override metadata, and the string link unfurlers and search snippets
      actually display — still read "permanent estate handoff" until
      2026-08-17, found by probing the live /demo page. The §19 guards checked
      the demo items and the page prose; nothing read what the <head> declares.

      The literal is extracted the same way `selectable()` extracts the enum:
      a regex over the assignment, so comments about estate (like the one now
      sitting above the constant) cannot trip it.
    */
    it('the inherited page metadata does not offer estate', () => {
      const g2 = gates().find((g) => g.id === 'g2-counsel-opinion');
      if (g2?.disposition === 'met') return; // an opinion exists; offering is now a decision

      const layout = readFileSync('src/app/layout.tsx', 'utf8');
      const m = /SITE_DESCRIPTION\s*=\s*(["'`])([\s\S]*?)\1/.exec(layout);
      expect(m, 'src/app/layout.tsx no longer declares SITE_DESCRIPTION as a single ' +
        'string literal — move this guard to wherever the inherited og/twitter ' +
        'description now lives; every non-overriding page serves it').toBeTruthy();
      expect(
        /estate|executor/i.test(m![2]),
        `The site-wide metadata description — inherited by every page without its ` +
          `own metadata, shown by every link unfurler — offers estate while ` +
          `g2-counsel-opinion is ${g2?.disposition ?? 'missing'}: “${m![2]}”`,
      ).toBe(false);
    });

    it('the code records the disposition instead of promising a door', () => {
      const g2 = gates().find((g) => g.id === 'g2-counsel-opinion');
      if (g2?.disposition !== 'declined') return;

      const raw = readFileSync('lib/domain/enums.ts', 'utf8');

      expect(
        /declined/i.test(raw) && /g2-counsel-opinion/.test(raw),
        'lib/domain/enums.ts does not mention that g2-counsel-opinion was DECLINED. ' +
          'A reader deciding whether this list may widen needs to know the gate is ' +
          'closed permanently, not merely unmet — say so where they will be standing.',
      ).toBe(true);

      expect(
        /TO RE-ENABLE[\s\S]{0,80}counsel/i.test(raw),
        'lib/domain/enums.ts still instructs the reader to re-enable estate once ' +
          'counsel clears. Counsel was declined — that never happens, so following ' +
          'the instruction would enable a permanently-closed capability while ' +
          'believing it completed a plan.',
      ).toBe(false);
    });
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
