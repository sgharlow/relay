/**
 * The displayed price and the charged price, and the gap between them.
 *
 * 🔴 TWO KNOBS, NO COUPLING. `PriceCard.tsx` renders
 * `NEXT_PUBLIC_PRICE_YEARLY_USD` when it is set; `POST /api/stripe/checkout`
 * always charges `RELAY_PLAN.priceId` — a fixed Stripe Price read from
 * `STRIPE_PRICE_RELAY_ANNUAL`. Setting the first to 99 shows a visitor $99 and
 * charges them $119, and nothing anywhere would notice. `.env.example` states
 * the limitation plainly ("this only overrides the displayed number"); no code
 * enforced it.
 *
 * 🔴 AND THE COMMENT THAT INTRODUCED IT WAS WRONG. It read "Runtime-configurable
 * so a price test does not require a deploy (J1-R8)" — but Next inlines
 * `NEXT_PUBLIC_*` at BUILD time, so changing it needs a redeploy exactly as
 * changing `lib/offer.ts` would. That sentence was then quoted into two other
 * files' headers as established fact, which is how a wrong claim becomes part of
 * the record. J1-R8 as written ("price configurable without deploy") is not met
 * and cannot be met by this mechanism.
 *
 * WHAT THIS TEST CAN AND CANNOT DO. It cannot compare the two numbers: the
 * charged one lives on a Stripe Price object and `STRIPE_SECRET_KEY` is a Vercel
 * *sensitive* variable, so there is no key here to ask with. What it can do is
 * keep the mechanism CONTAINED — the override reaches exactly one component and
 * never touches anything that decides what is charged or recorded — so the
 * divergence cannot spread beyond the one label it already affects. Closing it
 * properly means reading the price from Stripe server-side, or asserting
 * `unit_amount` against it in a verify step; both are recorded as not done.
 *
 * `lib/ops/price-single-definition.test.ts` guards the other half — that the
 * NUMBER is written down once. This guards the OVERRIDE.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R8
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OVERRIDE = 'NEXT_PUBLIC_PRICE_YEARLY_USD';

/**
 * The one file allowed to read it, and why.
 *
 * An allowlist with a stated reason, in the shape `body-limit.ts` and
 * `route-auth.ts` established: a second entry here is a deliberate decision
 * somebody has to write a justification for, not a line that slides in.
 */
const ALLOWED: Record<string, string> = {
  'src/app/(owner)/start/PriceCard.tsx':
    'the only surface that renders the override; display only, never a charge',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full.split('\\').join('/'));
    }
  }
  return out;
}

/** Comments are exempt: the code must be able to EXPLAIN the override. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('the price override cannot spread beyond the label it changes', () => {
  const readers = [...sourceFiles('lib'), ...sourceFiles('src')].filter((f) =>
    code(readFileSync(f, 'utf8')).includes(OVERRIDE),
  );

  it('is read in exactly the files that argue for it', () => {
    expect(readers.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('never reaches the routes that take or record money', () => {
    // The failure this forbids is concrete: a checkout session, or a
    // subscriptions row, built from a number chosen for a screen.
    for (const f of readers) {
      expect(f, `${f} must not read the display override`).not.toMatch(/^src\/app\/api\//);
    }
  });

  it('every allowlist entry states a reason worth reading', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

describe('what the code says about the override is true', () => {
  const card = readFileSync('src/app/(owner)/start/PriceCard.tsx', 'utf8');

  /*
    A CLAIM GUARD, in the shape of guide-claims.test.ts. The wrong sentence
    survived three months and was copied twice; a test is what stops the fourth
    copy, because the claim is about the BUILD SYSTEM and no amount of reading
    the component reveals it.

    ⚠️ SCOPED TO THE HEADER, and that is not laziness. This repo's house style
    keeps a superseded claim VISIBLE — struck through, dated — rather than
    quietly deleting it, so the corrected text quotes the wrong sentence on
    purpose. A whole-file ban on the phrase would fail on the correction itself
    and push the next person into erasing the history instead of recording it.
    The header is where a claim is made; below it, the phrase is evidence.
  */
  const header = card.slice(card.indexOf('/**'), card.indexOf('*/') + 2);

  it('the header no longer states the claim as current', () => {
    const stated = /(?:tested|configurable|changed)[^.]{0,40}without a deploy/i.test(header);
    const struckThrough = /~~[\s\S]*without a deploy[\s\S]*~~/.test(header);
    expect(stated && !struckThrough, 'the header still presents the wrong claim as true').toBe(
      false,
    );
  });

  it('records WHY it was wrong, rather than only deleting it', () => {
    expect(header).toMatch(/~~/);
    expect(card).toMatch(/inline[sd]? .{0,20}at BUILD time|inlined by Next at BUILD time/i);
  });

  it('says out loud that the override moves the label and not the charge', () => {
    // Comment leaders and line breaks are stripped first: a sentence that
    // happens to wrap is still the same sentence, and a test that cannot see
    // across a newline would be satisfied by rewrapping rather than by saying
    // the thing.
    const prose = card
      .toLowerCase()
      .replace(/^[ \t]*\*[ \t]?/gm, ' ')
      .replace(/\s+/g, ' ');
    expect(prose).toMatch(/only the number on the screen|displayed number only|not the charge/);
  });
});

describe('.env.example keeps warning whoever sets it', () => {
  it('still says the override changes the displayed number only', () => {
    // The variable is set by an operator in Vercel, where this file is the only
    // documentation they will see. If that sentence is ever trimmed, the one
    // warning attached to a $119 mistake goes with it.
    const env = readFileSync('.env.example', 'utf8');
    const at = env.indexOf(OVERRIDE);
    expect(at, 'the override is no longer documented').toBeGreaterThan(-1);
    expect(env.slice(Math.max(0, at - 400), at)).toMatch(/only overrides the displayed number/i);
  });
});
