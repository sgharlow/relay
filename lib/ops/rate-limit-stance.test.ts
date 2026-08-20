/**
 * The stance document names every endpoint the limiter guards, and the header
 * no longer justifies itself by a cancelled ad flight.
 *
 * THE FINDING (`PROJECT.yaml → deferred → the-rate-limiters-justification-cites-a-cancelled-flight`,
 * D6). `lib/http/rate-limit.ts` argued for itself as the right trade "for a $250
 * ad test", and named its upgrade trigger as lead spam during that flight. Paid
 * advertising was retired permanently on 2026-08-16, so the trade was against a
 * thing that no longer existed and the trigger could never fire. The
 * justification had been dead for four days and nothing noticed — which is the
 * actual defect, more than the stance itself.
 *
 * 🔴 WHY A TEST AND NOT JUST A DOCUMENT. A stance doc listing nine endpoints is
 * complete on the day it is written and quietly wrong the first time somebody
 * adds a tenth `rateLimit(` call. The exposure it describes would then be
 * understated, in the one document a reader would trust to be exhaustive. So the
 * list is DERIVED: every file that calls the limiter must appear in the doc.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STANCE = readFileSync(join(process.cwd(), 'docs/rate-limit-stance-2026-08-20.md'), 'utf8');
const MODULE = readFileSync(join(process.cwd(), 'lib/http/rate-limit.ts'), 'utf8');

/** Every route handler that calls the limiter, as `api/<route>`. */
function guardedRoutes(): string[] {
  const root = join(process.cwd(), 'src/app/api');
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts' && readFileSync(full, 'utf8').includes('rateLimit(')) {
        out.push(
          full
            .slice(root.length + 1)
            .replace(/\\/g, '/')
            .replace(/\/route\.ts$/, ''),
        );
      }
    }
  };

  walk(root);
  return out.sort();
}

describe('the header no longer rests on a dead premise', () => {
  it('does not present the cancelled ad flight as a live justification', () => {
    // The old text is QUOTED in the header, deliberately, so the correction is
    // legible. What must not survive is it standing as the current reasoning —
    // so the quote has to be accompanied by the retirement that killed it.
    if (MODULE.includes('$250 ad test')) {
      expect(
        MODULE,
        'the $250 trade is still in the header without the ruling that retired it',
      ).toContain('retire-paid-advertising');
    }
  });

  it('points at the re-derivation rather than re-arguing it inline', () => {
    expect(MODULE).toContain('rate-limit-stance-2026-08-20.md');
  });

  it('still says the thing that never stopped being true', () => {
    expect(MODULE).toMatch(/not a security boundary/i);
  });
});

describe('the stance document is exhaustive', () => {
  it('names every route that calls the limiter', () => {
    const missing = guardedRoutes().filter((r) => !STANCE.includes(`/api/${r}`));

    expect(
      missing,
      missing.length
        ? 'These routes call rateLimit() and are absent from the stance document:\n' +
          missing.map((m) => `  /api/${m}`).join('\n') +
          '\n\nAdd them to docs/rate-limit-stance-2026-08-20.md. A document that lists nine ' +
          'endpoints and guards ten understates the exposure in the one place a reader trusts ' +
          'to be exhaustive.'
        : 'ok',
    ).toEqual([]);
  });

  it('finds a real set, so a broken walk cannot pass vacuously', () => {
    // A check that discovers nothing passes. This is the guard on the guard.
    expect(guardedRoutes().length).toBeGreaterThan(10);
  });

  it('records a recommendation and marks a shared store as out of scope to take', () => {
    expect(STANCE).toMatch(/recommend/i);
    // Proposing is in scope; adding infrastructure is not, and the doc has to
    // say so or it reads as a plan rather than a decision request.
    expect(STANCE).toMatch(/5-gate policy|infrastructure: proposing is in scope/i);
  });
});
