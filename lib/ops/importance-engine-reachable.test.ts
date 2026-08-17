/**
 * The importance engine has to be reachable AFTER onboarding.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, found 2026-08-17. `runIntake` is the only
 * thing that sets `is_root_credential`, `irreplaceable`, `recurring_billing`,
 * `importance_score` and `depends_on_item_id`. `/api/ai/intake` had exactly one
 * caller in the whole product: `SeedWizard`, on `/start`.
 *
 * So a vault built the ordinary way — "Add item", one account at a time — was
 * never classified. Every row kept `importance_score` 0.5 and
 * `depends_on_item_id` null, with these consequences, none of which surface as
 * an error:
 *
 *   - `computeReveal`, the J1 "aha" that names the one account everything else
 *     depends on, returns its "add a few more accounts" fallback FOREVER. That
 *     reveal renders before any price is shown, so the moment the product uses
 *     to justify itself never happened for these owners.
 *   - `detectGaps` never raises a CUSTODY_RISK, because nothing is ever marked
 *     irreplaceable — and custody risks are the items that cannot be
 *     regenerated from a login.
 *   - `/vault` advertises "most consequential first" while sorting on a column
 *     that is 0.5 for every row.
 *
 * WHY `api-reachability.ts` DID NOT CATCH IT. That check asks whether a handler
 * has any caller at all, and this one did. "Reachable exactly once, during
 * onboarding, and never again" is a different question, and it is the question
 * that matters for a capability an owner needs repeatedly.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.8, 12.1, J1-R6
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = '/api/ai/intake';
/** Onboarding. A real caller, but it runs once in an account's life. */
const ONBOARDING = 'src/app/(owner)/start/SeedWizard.tsx';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files that actually call the endpoint, comments stripped so a mention is not a call. */
function callers(): string[] {
  return walk('src/app').filter((file) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    return src.includes(ENDPOINT);
  });
}

describe('an owner can re-run the importance engine after onboarding', () => {
  it('is callable from somewhere other than the onboarding wizard', () => {
    const outside = callers()
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f !== ONBOARDING);
    expect(
      outside,
      `${ENDPOINT} is reachable only from ${ONBOARDING}. Every vault built by hand after ` +
        'onboarding stays unclassified: no root credential, no dependencies, nothing ' +
        'irreplaceable, and the risk-graph reveal can never fire.',
    ).not.toEqual([]);
  });

  it('the onboarding caller is still there — this guard is about adding a path, not moving one', () => {
    // If /start stopped running the analysis, a brand-new imported vault would
    // arrive unclassified and the fix above would be masking a new regression.
    expect(callers().map((f) => f.replace(/\\/g, '/'))).toContain(ONBOARDING);
  });

  it('the budget refusal is handled as its own outcome, not as a failure', () => {
    /*
      /api/ai/intake is metered twice and returns 429 with Retry-After. A 429 is
      not an error: nothing went wrong, the owner has used today's runs, and the
      vault is untouched. Reporting it as a failure would send someone chasing a
      bug that does not exist — and would hide the one fact that helps, which is
      when they can try again.
    */
    const vault = readFileSync('src/app/(owner)/vault/VaultDashboardClient.tsx', 'utf8');
    expect(vault, 'the 429 budget response needs its own branch').toMatch(/429/);
    expect(vault, 'and it should tell them their vault is unchanged').toMatch(/unchanged/i);
  });
});
