/**
 * The user's guide must not describe the withdrawn handover as "not yet".
 *
 * 🔴 THE SAME DOCUMENT SAID BOTH THINGS. Part 6 of public/guide/index.html is
 * unambiguous — "It does not do estates, and it is not going to… not offered,
 * not scheduled, and not waiting on anything." Two earlier sections hedged:
 *
 *   §4.3 "…that is not available to customers yet. See Part 6."
 *   §4.6 "The permanent handover that would speak to any of that is not offered
 *         today (Part 6)."
 *
 * "yet" and "today" are the words that turn a permanent withdrawal back into a
 * roadmap item. PROJECT.yaml says exactly why that matters: a gated framing
 * "would keep it reading as temporary… which is how a withdrawn capability gets
 * quietly rebuilt". Both sentences even point AT Part 6, which contradicts them.
 *
 * ⚠️ lib/ops/guide-claims.test.ts forbids "legal opinion" and "when it does
 * arrive" — the phrasings the earlier version of this drift used. It has no
 * pattern for "yet" or "today", which is why these two survived it. Extending
 * that file's negative list is the lane fix; this is the local half.
 *
 * 🔴 AND THE PDF WENT ON SAYING BOTH, WHILE BEING SERVED AND LINKED. The guide
 * ships twice: this HTML, and public/guide/relay-guide.pdf, printed from the
 * served page by scripts/guide-pdf.mjs — which needs `next build && next start`
 * and is therefore a step somebody has to take. The HTML was corrected on
 * 2026-08-21 and the PDF, last generated 2026-08-18, still carried "not
 * available to customers yet" and "not offered today" — and /help offered it as
 * a download. A note in this header recorded that (2026-08-21) and nothing acted
 * on it, which is the same "somebody will remember" the rest of this repo has
 * stopped accepting: a comment is not a guard.
 *
 * So the guard below is about the LINK rather than the file. It cannot regenerate
 * a PDF and it must not fail the suite for a step that needs a build; what it can
 * do is refuse to let a stale copy be OFFERED. While the PDF is older than the
 * HTML it is presumed to disagree with it, and no page may link it. Regenerate
 * it and the guard goes quiet on its own — the same commit that makes the
 * download honest is the one that may restore the link.
 *
 * Feature: relay-h0-mvp
 * Requirements: J10 (withdrawn)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const GUIDE = 'public/guide/index.html';
const PDF = 'public/guide/relay-guide.pdf';

const text = () =>
  readFileSync(GUIDE, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ');

describe('the guide describes the handover as withdrawn, not delayed', () => {
  it.each([
    ['not available to customers yet', /not available to customers yet/i],
    ['not offered today', /not offered today/i],
  ])('does not say "%s"', (_label, re) => {
    expect(
      text(),
      `${GUIDE} frames the permanent handover as temporary, which its own Part 6 denies`,
    ).not.toMatch(re);
  });

  it('says no temporal hedge about the handover at all', () => {
    /*
      Broader than the two known sentences: any "not … yet/today/for now" within
      a few words of the handover is the same drift wearing different clothes.
    */
    const hedged = /permanent handover[^.]{0,120}\b(yet|today|for now|at the moment|currently)\b/i;
    expect(hedged.exec(text())?.[0] ?? null).toBeNull();
  });

  it('still tells the reader the handover does not exist', () => {
    // Deleting the hedge must not delete the answer. Somebody reading §4.6 is
    // asking whether Relay settles an estate, and it must still say no.
    expect(text()).toMatch(/no permanent handover|does not do estates|not offered/i);
  });
});

/**
 * The date of a file's last commit, or null when git cannot answer.
 *
 * Null rather than a throw, exactly as src/app/terms/legal-pages.test.ts does it:
 * a source export, a shallow clone or a sandbox without git must SKIP this, not
 * fail it. A guard that cannot run everywhere is still worth having where it can.
 */
function lastCommitDate(file: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Every source file under src/ — the pages that could offer the download. */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the printable copy is not offered while it disagrees with the guide', () => {
  it('nothing links the PDF while it is older than the page it is printed from', () => {
    const html = lastCommitDate(GUIDE);
    const pdf = lastCommitDate(PDF);
    if (!html || !pdf) return; // no git — covered by the content assertions above

    if (pdf >= html) return; // regenerated: the download is as current as the page

    /*
      Comments stripped, and that is load-bearing: the page that used to carry
      the link now carries a paragraph EXPLAINING why it does not, which names
      the file. A guard that cannot tell an explanation from an offer punishes
      writing the explanation down.
    */
    const offering = sourceFiles().filter((f) =>
      readFileSync(f, 'utf8')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .includes('relay-guide.pdf'),
    );
    expect(
      offering,
      `${PDF} was last generated ${pdf} and ${GUIDE} was changed ${html}, so the download ` +
        'carries wording the page no longer does — including, on 2026-08-21, the withdrawn ' +
        'handover described as "not available to customers yet". Either regenerate it ' +
        '(`npx next build && npx next start -p 3100` then `node scripts/guide-pdf.mjs`) and ' +
        'restore the link in that same commit, or leave it unlinked.',
    ).toEqual([]);
  });

  it('the file itself is still shipped, so regenerating restores a working link', () => {
    // Unlinking is a pause, not a deletion. lib/ops/support-reachability.test.ts
    // stats this path too; if it ever goes missing, the fix above is unavailable.
    expect(() => statSync(PDF)).not.toThrow();
  });
});
