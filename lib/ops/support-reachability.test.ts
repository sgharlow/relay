/**
 * Can the reader reach help FROM THE MODE THEY ARE STANDING IN?
 *
 * 🔴 THE QUESTION `findUnlinkedPages()` CANNOT ASK. That guard checks whether a
 * page is linked from anywhere in the product, and on 2026-08-13 `/help` was —
 * from the owner sidebar and the landing page. It was reachable, and every
 * contact-facing screen was still a dead end: /claim, /access, /break-glass and
 * /verify offered no way to ask a question, and /standby was the only screen in
 * either mode that did. The audit found it by hand the day after /help shipped.
 *
 * "Reachable from somewhere" is the wrong predicate for a product with three
 * separate modes and no navigation between them. A recipient mid-emergency
 * never sees the owner sidebar. This asserts the predicate that matters.
 *
 * WHY A RENDERED-OUTPUT CHECK IS NOT USED HERE. The layouts are server
 * components and the pages beneath them are client components; rendering the
 * real tree needs a browser, which is what scripts/a11y-audit.mjs is for. This
 * is the cheap structural half: every route group that serves a non-owner
 * reader carries the footer in its layout, so no page in it can be added
 * without one. The expensive half is one axe run away.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHARED_FOOTER = 'SupportFooter';

/**
 * 🔴 THIS CHECK WAS FALSE-GREEN ON ITS FIRST RUN, and the repo had already
 * written down why. `api-reachability.ts` warns that a module path is not a
 * link; the same trap one layer over is that an IMPORT is not a RENDER. Testing
 * for the bare name `SupportFooter` passed on a layout with the element deleted
 * and only `import SupportFooter from …` left behind — proven by deleting it
 * and watching the suite stay green.
 *
 * So: match the JSX element, not the identifier.
 */
const RENDERS_FOOTER = new RegExp(`<${SHARED_FOOTER}\\s*/?>`);

/**
 * The route groups whose readers are NOT the owner.
 *
 * Owner mode is deliberately absent: it has a permanent Help entry in the
 * sidebar, which is the equivalent guarantee by a different mechanism.
 */
const CONTACT_MODES = ['src/app/(access)', 'src/app/(verify)'];

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === 'page.tsx') out.push(p.split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

describe('support is reachable from every contact-facing mode', () => {
  for (const mode of CONTACT_MODES) {
    it(`${mode}/layout.tsx renders the shared support footer`, () => {
      const layout = readFileSync(join(mode, 'layout.tsx'), 'utf8');
      expect(
        RENDERS_FOOTER.test(layout),
        `${mode}/layout.tsx does not render ${SHARED_FOOTER}. Every page in this ` +
          'group is read by somebody who did not sign up for Relay and cannot see ' +
          'the owner sidebar. Without it they have no way to ask a question — ' +
          'which is what /claim, /access, /break-glass and /verify each were until ' +
          '2026-08-13.',
      ).toBe(true);
    });

    it(`${mode} has at least one page, so the check above is guarding something`, () => {
      /*
        A layout with no pages under it would pass the assertion above while
        protecting nobody. If a route group is emptied out, this fails and the
        entry belongs in CONTACT_MODES no longer.
      */
      expect(pagesUnder(mode).length).toBeGreaterThan(0);
    });
  }

  /*
    🔴 THE GUIDE WAS WRITTEN AND NOT SHIPPED. 42 sections and 24 screenshots
    sat in docs/ with no public directory, no route and no link, while
    beta-flag.test.ts guarded a promise made in §2.7 of it. Nothing failed,
    because nothing was asking whether a reader could open it.

    A doc is delivered when it is SERVED, LINKED, and its assets RESOLVE. All
    three, because each has its own way of quietly not being true: a file
    outside public/ is never served, a served file nobody links to is never
    found, and a manual whose images 404 is worse than no manual for the
    audience CC8 names.
  */
  it('the guide is served, linked, and its screenshots resolve', () => {
    const guide = 'public/guide/index.html';
    const html = readFileSync(guide, 'utf8');

    const missing = [...html.matchAll(/src="(screens\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((rel, i, a) => a.indexOf(rel) === i)
      .filter((rel) => {
        try {
          statSync(join('public/guide', rel));
          return false;
        } catch {
          return true;
        }
      });
    expect(missing, `${guide} references screenshots that are not beside it`).toEqual([]);

    statSync('public/guide/relay-guide.pdf');

    const linksToGuide = ['src/app/help/page.tsx', 'src/app/page.tsx'].some((f) =>
      /href="\/guide"/.test(readFileSync(f, 'utf8')),
    );
    expect(
      linksToGuide,
      'Nothing in the product links to /guide. A guide that ships without a link ' +
        'is the same defect as one that never shipped — it was written for a ' +
        'reader who still cannot find it.',
    ).toBe(true);
  });

  it('the footer points at a page that exists and says what it links to', () => {
    const footer = readFileSync(`src/app/_components/${SHARED_FOOTER}.tsx`, 'utf8');
    expect(footer).toContain('href="/help"');
    statSync('src/app/help/page.tsx');
  });

  /*
    THE DUPLICATE THIS REPLACED. /standby carried its own copy of the sentence
    before the layout did. Two copies is how the wording in one place drifts
    from the wording in another, and a reader comparing screens mid-emergency is
    the last person who should meet an inconsistency.
  */
  it('no page re-implements the footer the layout already provides', () => {
    const offenders = CONTACT_MODES.flatMap((mode) =>
      readdirSync(mode, { recursive: true, encoding: 'utf8' })
        .map((f) => join(mode, f).split('\\').join('/'))
        .filter((f) => /\.tsx$/.test(f) && !f.endsWith('layout.tsx'))
        .filter((f) => statSync(f).isFile())
        .filter((f) => /href=["']\/help["']/.test(readFileSync(f, 'utf8'))),
    );
    expect(
      offenders,
      'These files link to /help directly while their layout already does. ' +
        'Delete the local copy — a deep link to a specific answer (/help#id) is ' +
        'fine and does not match this.',
    ).toEqual([]);
  });
});
