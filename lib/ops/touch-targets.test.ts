/**
 * The phone floor, pinned so it cannot quietly erode.
 *
 * 🔴 WHAT THIS GUARDS, AND WHY IT IS NOT COSMETIC. Measured live at 390px on
 * 2026-08-14: "I'm fine — check in" was 145x35 and partially off-screen, every
 * text field was 39px, the reversible/permanent checkbox was a 13px box in a
 * 22px label. The wedge is elderly owners, and the two owner-mode jobs that
 * happen away from a desk — checking in on /triggers, answering on /challenge —
 * are both time-limited. A missed tap on check-in does not fail politely: the
 * window lapses, the release advances, and the person's whole circle is told
 * something has happened to them.
 *
 * WHAT THIS TEST CAN AND CANNOT DO. It is a source-level ratchet: it proves the
 * rules are still declared, not that any given screen renders correctly. Only a
 * real viewport can prove that, which is exactly how these defects were found —
 * the automated pass reported the /triggers card clean, because the card
 * clipped its overflowing child and scrollWidth still equalled innerWidth.
 * Treat a green here as "the floor is still written down", never as "the phone
 * is fine". The live pass is the proof; this is the memory.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('src/app/globals.css', 'utf8');

/** The touch block: narrow viewports OR any coarse pointer. */
function touchBlock(): string {
  const start = css.indexOf('@media (max-width: 720px), (pointer: coarse)');
  expect(start, 'the touch-target media query is gone from globals.css').toBeGreaterThan(-1);
  // Walk braces so the assertions below cannot accidentally read a later rule.
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces in the touch-target block');
}

describe('touch targets survive on a phone', () => {
  const block = touchBlock();

  it('holds standalone controls to 44px', () => {
    expect(block).toContain('min-height: 44px');
    for (const sel of ['button', 'select', 'textarea']) {
      expect(block, `${sel} lost its floor`).toContain(sel);
    }
  });

  /*
    Checkboxes are excluded from the blanket min-height on purpose — it would
    make a tall thin rectangle rather than a bigger target — so the box is
    squared up and the LABEL carries the 44px. Both halves are asserted,
    because either one alone leaves the control under the floor.
  */
  it('gives the reversible/permanent checkbox a real box AND a real label', () => {
    expect(block).toMatch(/input\[type='checkbox'\][\s\S]*?width: 24px/);
    expect(block).toMatch(/input\[type='checkbox'\][\s\S]*?height: 24px/);
    expect(block).toMatch(/label:has\(> input\[type='checkbox'\]\)/);
  });

  /*
    Scoped, not global. Owner-mode density at desktop is a ratified design
    property and every visual approval to date happened there; inflating those
    controls would change approved screens to fix a problem a mouse does not
    have. If this assertion ever fails, the floor has leaked into desktop.
  */
  it('does not apply the floor at desktop widths with a mouse', () => {
    expect(css).not.toMatch(/^\s*button\s*\{[^}]*min-height: 44px/m);
  });
});

/*
  🔴 `basis-full` IS A NO-OP IN A NOWRAP FLEX ROW, AND THAT IS WHAT CLIPPED THE
  CHECK-IN BUTTON. The class asks for 100% of the line, but only a WRAPPING
  container gives it its own line; without flex-wrap it simply shrinks to
  whatever is left — 51px, setting a sentence one word per line for twenty
  lines, with the button pushed past the right edge reading "I'm fine — che".

  File-level rather than element-level: a JSX className is not statically
  associated with its parent container without parsing. A file that uses
  `basis-full` and never mentions `flex-wrap` is the signature of the bug, so
  that is what is asserted.
*/
describe('basis-full is only used where a container can wrap', () => {
  function tsxFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'node_modules' || name === '.next') continue;
      if (statSync(p).isDirectory()) tsxFiles(p, acc);
      else if (name.endsWith('.tsx')) acc.push(p);
    }
    return acc;
  }

  /*
    🔴 COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. The first version
    of this test read the raw file, and it PASSED when flex-wrap was deleted
    from the very component the test exists to protect — because the paragraph
    above that component explaining the bug contains the words "flex-wrap".
    The check was matching its own prose.

    That is the third instance of this exact shape in this codebase (a favicon
    palette check matched the hex in its own comment; a webhook verifier
    compared a timestamp against itself). The rule it teaches: a test that reads
    source must read the CODE, and it is not trustworthy until it has been
    watched to fail.
  */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  it('every file using basis-full also sets flex-wrap', () => {
    const offenders = tsxFiles('src')
      .map((f) => ({ f, code: stripComments(readFileSync(f, 'utf8')) }))
      .filter(({ code }) => code.includes('basis-full') && !code.includes('flex-wrap'))
      .map(({ f }) => f);

    expect(offenders, `basis-full without flex-wrap collapses to a sliver:\n${offenders.join('\n')}`)
      .toEqual([]);
  });
});
