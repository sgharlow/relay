/**
 * The diligence pack's instructions have to work when a partner runs them.
 *
 * 🔴 FOUND 2026-08-31 (A6.5, ROADMAP Sprint 7 — "the diligence pack meets its
 * first reader"). `docs/g3-diligence-pack.md` §3 opens with *"derive rather than
 * quote"* and hands the reader a command:
 *
 *     grep -A 30 -i "subprocessor" src/app/privacy/page.tsx
 *
 * It returned **nothing**. `/privacy` does not use the word "subprocessor" — the
 * section is headed **"Who else is involved"**, in plain English, deliberately.
 * The page was right and the command was wrong, which is the more embarrassing
 * way round: a partner following the first instruction in the pack would
 * conclude the list does not exist.
 *
 * The pack was written on 2026-08-30 and broke a reader's first step within a
 * day. That is the same shape as every other finding this week — a document
 * asserting something nothing checked — except this one is handed to somebody
 * outside the company, which is the worst audience to discover it with.
 *
 * ⚠️ WHAT THIS DOES NOT CHECK, so its green is not read as wider than it is: it
 * cannot tell whether the pack's ANSWERS are good, whether the legal position is
 * sound, or whether a partner will accept "there is no legal opinion". Those are
 * judgement, and the pack's whole premise is that the honest version survives
 * contact better than the polished one.
 *
 * Feature: relay-g1-wtp
 * Requirements: A6.5
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const PACK = 'docs/g3-diligence-pack.md';
const PRIVACY = 'src/app/privacy/page.tsx';

/** The vendors §3 tells a partner they will find. */
const NAMED_IN_THE_PACK = ['AWS', 'Vercel', 'Resend', 'Stripe'] as const;

/** How each appears on the page — the pack uses short names, the page is prose. */
const ON_THE_PAGE: Readonly<Record<string, string>> = {
  AWS: 'Amazon Web Services',
  Vercel: 'Vercel',
  Resend: 'Resend',
  Stripe: 'Stripe',
};

function packSection(heading: string): string {
  const src = readFileSync(PACK, 'utf8');
  const at = src.indexOf(heading);
  expect(at, `${PACK} no longer has a "${heading}" section`).toBeGreaterThan(-1);
  const next = src.indexOf('\n## ', at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

describe('the G3 diligence pack', () => {
  it('exists, because a gate points a partner at it', () => {
    expect(existsSync(PACK)).toBe(true);
    expect(existsSync(PRIVACY)).toBe(true);
  });

  it('🔴 its subprocessor command actually returns the subprocessor list', () => {
    /*
      The regression test for the defect above. The command is extracted from the
      pack rather than hard-coded here, so editing the pack to a command that
      does not work fails HERE — which is the only place it can fail before a
      partner runs it.
    */
    const section = packSection('## 3 · Subprocessors');
    const cmd = /```bash\n([\s\S]*?)```/.exec(section)?.[1]?.trim();
    expect(cmd, 'the pack no longer carries a derivation command in §3').toBeTruthy();

    const term = /grep\s+-A\s+\d+\s+(?:-i\s+)?"([^"]+)"/.exec(cmd!)?.[1];
    expect(term, `could not read the grep term out of: ${cmd}`).toBeTruthy();

    const page = readFileSync(PRIVACY, 'utf8');
    const at = page.indexOf(term!);
    expect(
      at,
      `The pack tells a partner to run:\n    ${cmd}\n` +
        `and "${term}" does not appear in ${PRIVACY}. The first instruction in a document handed ` +
        'to an outside reader returns nothing. This is exactly how the -i "subprocessor" version ' +
        'shipped on 2026-08-30.',
    ).toBeGreaterThan(-1);

    // And it must return the vendors, not merely match a heading somewhere.
    const window = page.slice(at, at + 3000);
    for (const short of NAMED_IN_THE_PACK) {
      expect(
        window.includes(ON_THE_PAGE[short]),
        `the pack names ${short} as a subprocessor and "${ON_THE_PAGE[short]}" is not in what the ` +
          'command returns',
      ).toBe(true);
    }
  });

  it('names no vendor the privacy page does not', () => {
    // The other direction: a pack that over-lists is a disclosure problem, and a
    // partner comparing the two documents is precisely who would notice.
    const page = readFileSync(PRIVACY, 'utf8');
    for (const short of NAMED_IN_THE_PACK) {
      expect(page.includes(ON_THE_PAGE[short]), `${short} is in the pack and not on /privacy`).toBe(
        true,
      );
    }
  });

  it('still leads with the absence of a legal opinion rather than burying it', () => {
    /*
      The pack's premise, and the thing most likely to be softened by a later
      edit trying to make it read better. A one-person product claiming a cleared
      legal position it does not have is the claim that gets found.
    */
    const head = readFileSync(PACK, 'utf8').slice(0, 1400);
    expect(head).toMatch(/no legal opinion/i);
    expect(head).toMatch(/DECLINED/);
  });

  it('does not claim the restore drill has run', () => {
    // It has not. `gates.d3-restore-drill` carries `preflight:`, not `met:`, and
    // the pack must not quietly promote one to the other.
    const section = packSection('## 5 · SOC 2 / DPA posture');
    expect(section).toMatch(/restore drill has not run/i);
    expect(section).not.toMatch(/restore drill (?:has been|was) (?:run|completed|proven)/i);
  });
});
