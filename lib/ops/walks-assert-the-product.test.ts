/**
 * A walk that recomputes the answer is testing the function twice and the path
 * not at all.
 *
 * 🔴 WHAT THIS IS WRITTEN FROM, 2026-08-18. `assessPreparedness` reads three
 * columns that `assessReadiness` neither selected nor passed on. Every item
 * reached the rule as `unknown`, `checkingStarted` was permanently false, and
 * the second-factor correction was INERT on the banner from the day it shipped
 * — the one surface that renders the sentence.
 *
 * Nothing was red, and `verify:factors` was the greenest thing in the repo:
 * it imported `assessPreparedness`, fetched vault rows ITSELF, and asserted on
 * its own arithmetic. So it proved the function, twice, and the product's path
 * — SQL projection, row mapping, the endpoint, the payload — zero times. The
 * defect lived in the gap between two things that were each locally correct.
 *
 * The rule this fixes: a walk may import what it needs to BEHAVE like a client
 * — encrypt as the browser does, mint a session, sign in, clean up — and never
 * a module that computes an answer the product is supposed to compute. If the
 * walk wants to know what the product would say, it must ASK the product.
 *
 * The population is read from `verify:live` in package.json rather than from a
 * list here, so a sixth walk added to the release chain is covered the moment
 * it joins it. A check whose subject list is hand-maintained goes blind exactly
 * when the thing it watches grows.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** The scripts the release chain runs, resolved through `verify:live`. */
function walkFiles(): string[] {
  const chain = pkg.scripts['verify:live'];
  expect(chain, 'verify:live has vanished from package.json — this check has no subject').toBeTruthy();

  const names = [...chain.matchAll(/npm run (verify:[a-z-]+)/g)].map((m) => m[1]);
  expect(names.length, 'verify:live no longer composes named walks; re-read it').toBeGreaterThan(0);

  return names.map((name) => {
    const cmd = pkg.scripts[name];
    const file = /(scripts\/[\w.-]+\.ts)/.exec(cmd ?? '')?.[1];
    expect(file, `${name} does not resolve to a script file`).toBeTruthy();
    return file as string;
  });
}

/**
 * What a walk may import, and why. Each entry earns its place by naming the
 * client behaviour it supplies — none of them computes a claim.
 */
const MAY_IMPORT: Array<{ prefix: string; because: string }> = [
  { prefix: 'lib/crypto/', because: 'encrypts exactly as the browser does' },
  { prefix: 'lib/auth/totp', because: 'produces the code a person would type' },
  { prefix: 'lib/auth/verifier-token', because: 'mints the token an emailed link carries' },
  { prefix: 'lib/auth/session-epoch', because: 'forges the cookie a signed-in browser holds' },
  { prefix: 'lib/db/connection', because: 'fixture teardown and direct-state checks' },
  /*
    The stamp is in the chain but is not a walk: it asserts nothing about the
    product, it records that the walks before it exited 0. It imports the log's
    PATH and its TYPE — no claim, nothing computed — and importing them beats
    spelling the path twice, which is the drift this repo bans elsewhere. It is
    listed here rather than exempted from walkFiles(), because "everything in
    the verify:live chain is held to the walk rules" is the safer default: an
    exemption is a hole somebody later walks through.
  */
  {
    prefix: 'lib/ops/verify-live-freshness',
    because: 'the run log\'s path and record type — the stamp computes no answer about the product',
  },
];

describe('the release walks assert the product, not their own arithmetic', () => {
  it('no walk imports a module that computes an answer', () => {
    const offenders: string[] = [];

    for (const file of walkFiles()) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      for (const m of src.matchAll(/^import[^'"]*['"]\.\.\/(lib\/[^'"]+)['"]/gm)) {
        const spec = m[1];
        if (MAY_IMPORT.some((a) => spec.startsWith(a.prefix))) continue;
        offenders.push(`${file} imports ${spec}`);
      }
    }

    expect(
      offenders,
      'These walks import domain logic. A walk that computes the answer itself cannot see a ' +
        'break between the database and the endpoint — which is exactly the defect that shipped ' +
        'on 2026-08-18 while verify:factors was green. Ask the product instead: read the API ' +
        'route the screen reads. If an import really is client behaviour rather than an answer, ' +
        'add it to MAY_IMPORT with the behaviour it supplies.',
    ).toEqual([]);
  });

  /*
    The positive half. Refusing the import is only half the rule — the walk has
    to actually go and ask. If no walk ever reads the endpoint behind the
    product's headline sentence, the path is unasserted whether or not anyone
    imports anything.
  */
  it('the endpoint behind the preparedness sentence is read by a walk', () => {
    const read = walkFiles().some((f) =>
      readFileSync(join(process.cwd(), f), 'utf8').includes('/api/readiness'),
    );

    expect(
      read,
      'No walk in the release chain reads /api/readiness. That endpoint composes the SQL ' +
        'projection, the row mapping and assessPreparedness into the sentence on every owner ' +
        'screen, and on 2026-08-18 it was broken for a day with 2,696 unit tests green. Reading ' +
        'it is the assertion that spans all three.',
    ).toBe(true);
  });
});
