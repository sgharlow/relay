/**
 * The import report may only name controls that exist, and numbers it can back.
 *
 * 🔴 A LANE DELETING COPY THAT PROMISES WHAT DOES NOT EXIST WROTE A NEW ONE.
 * The `coverageDeferred` branch added on 2026-08-21 told the owner: "Open Rules
 * and re-apply your rules to cover them." There is no re-apply. Nothing in `src`
 * or `lib` matches /re-?apply/ except that sentence, and the only path that
 * materialises a policy across items is `materializePolicy`, reached by CREATING
 * a policy (POST /api/policies) from the Accept control on /circle — which
 * `src/app/api/circle/route.ts` offers only while the owner holds NO policies,
 * and this branch fires only when they hold at least one. So the one screen it
 * named had no such button, and the screen that has one would have shown the
 * owner nothing.
 *
 * It fires on the ordinary case, too: any import creating more than
 * COVERAGE_INLINE_MAX items for an owner with a policy — a password-manager
 * export, the path the product recommends as how to start.
 *
 * 🔴 AND THE SKIP LIST NUMBERED ITSELF TWO DIFFERENT WAYS UNDER ONE WORD. The
 * duplicate list said "Rows left out, by their line in your file" over an index
 * into the uploaded batch, printed on the same screen as the parser's skip list,
 * which numbers by `dataRow` and IS the line in the file. One unreadable row
 * shifts every number in the first list by one, so a messy export — exactly the
 * kind that produces skips — sent an owner to the wrong line of their own file.
 *
 * Feature: relay-h0-mvp
 * Requirements: 10.4, J2, J4-R4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = 'src/app/(owner)/import/ImportPageClient.tsx';

const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

/** What a person reads: comments stripped, whitespace as it renders. */
function copy(): string {
  return stripComments(readFileSync(CLIENT, 'utf8')).replace(/\s+/g, ' ');
}

/**
 * Every route the app actually serves a page for, read from the file tree.
 *
 * Route groups — `(owner)`, `(access)` — are directory names only and never
 * appear in a URL, which is precisely the confusion that makes a hand-written
 * href easy to get wrong.
 */
function servedPages(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, /^\(.*\)$/.test(entry) ? route : `${route}/${entry}`);
      } else if (entry === 'page.tsx') {
        routes.add(route === '' ? '/' : route);
      }
    }
  };
  walk('src/app', '');
  return routes;
}

describe('the import screen points at controls that exist', () => {
  it('every internal link it renders resolves to a page', () => {
    const served = servedPages();
    const linked = [...readFileSync(CLIENT, 'utf8').matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]);
    const dangling = linked.filter((href) => !served.has(href.replace(/\/$/, '')));
    expect(
      dangling,
      `${CLIENT} links to a route no page serves — a sentence with nothing to press`,
    ).toEqual([]);
  });

  it('does not offer a re-apply, which is not a control this product has', () => {
    expect(
      copy(),
      'nothing in src or lib re-applies existing policies across items; saying so sends the ' +
        'owner to a screen to look for a button that is not there',
    ).not.toMatch(/re-?apply/i);
  });

  it('when coverage is deferred, it names the screen that CAN grant access', () => {
    /*
      /rules creates one access rule for one item and one recipient — the thing
      that actually makes an imported item reachable. It is per-item and this
      branch fires above 100 items, so the copy must not pretend it is a batch
      control either; the assertion is only that the screen it names is real and
      linked.
    */
    const src = readFileSync(CLIENT, 'utf8');
    const deferred = src.slice(src.indexOf('report.coverageDeferred'));
    expect(deferred, 'the deferred branch should link the Rules screen').toMatch(/href="\/rules"/);
    expect(servedPages().has('/rules')).toBe(true);
  });
});

describe('a failure after the upload is not reported as an abort', () => {
  /*
    🔴 ONE `catch` COVERED TWO OPPOSITE OUTCOMES and told the owner the safer of
    them had happened. "Import aborted: …" is true of a row that failed to
    encrypt — nothing has left the browser, Req 10.4. It is NOT true of a failure
    after `apiSend`: /api/import inserts every item BEFORE it scores or covers
    anything, and its own comment explains that a timeout in the coverage pass
    "would report a successful import as a failure". The owner reads "aborted",
    imports again, and now owns two of everything — which is the exact defect
    lib/vault/dedupe.ts exists to prevent and cannot prevent here, because the
    second run is a genuine re-import the vault has no memory of refusing.
  */
  it('does not call every failure an abort', () => {
    expect(
      copy(),
      'a request that failed after the items were sent did not abort anything',
    ).not.toMatch(/import aborted/i);
  });

  it('tells an owner to check the vault before importing again', () => {
    const src = readFileSync(CLIENT, 'utf8');
    const send = src.slice(src.indexOf("apiSend<"));
    expect(
      stripComments(send),
      'the post-upload failure path must say the items may already be saved',
    ).toMatch(/open your vault|already be (?:in your vault|saved)/i);
  });

  it('still says plainly when nothing was uploaded', () => {
    // The other half must survive: an encryption failure genuinely uploads
    // nothing, and saying so is what stops a needless re-import.
    expect(copy()).toMatch(/nothing (?:was |has been )?(?:uploaded|sent)/i);
  });
});

describe('the skip lists do not number themselves two different ways', () => {
  it('does not call the batch position a line in the file', () => {
    expect(
      copy(),
      'the duplicate list is indexed into the uploaded batch, which excludes every row the ' +
        'parser dropped — so it is not the line in the file, and the parser skip list above ' +
        'it on the same screen IS',
    ).not.toMatch(/line in your file/i);
  });

  it('renders the field the route actually sends', () => {
    // Named `position` in the response for the same reason. If this ever reads
    // `d.row` again, the route has been reverted or the client has drifted.
    expect(copy()).toMatch(/d\.position/);
    expect(copy()).not.toMatch(/d\.row\b/);
  });

  it('the parser skip list still reports the true file row', () => {
    // The half that was always right, asserted so a tidy-up of the two lists
    // cannot make them agree by breaking this one.
    expect(copy()).toMatch(/s\.row/);
  });
});
