/**
 * Not every enforced CSP violation is a broken page.
 *
 * 🔴 MEASURED 2026-08-31 (B21.2). `npm run verify:csp` reported **6 enforced**
 * violations under the banner *"A real person met a broken page"* and exited 1.
 * All six were `https://vercel.live/_next-live/feedback/feedback.js` — the Vercel
 * toolbar, injected for a signed-in operator browsing production, and refused by
 * a policy of `script-src 'self' 'unsafe-inline' 'unsafe-eval'`.
 *
 * The policy did exactly what it is for. Nothing in the product was blocked,
 * `vercel.live` does not appear in the production HTML, and no customer met
 * anything. The banner was true of the mechanism and wrong about the meaning.
 *
 * ⚠️ WHY THAT MATTERS MORE THAN THE WORDING. An operator who reads it literally
 * goes hunting for a product defect that does not exist. An operator who learns
 * to discount it stops reading the enforced half **at all** — and then a real
 * enforced violation, the kind that does break a page for a customer, arrives in
 * a section everybody has been trained to skip. A check that cries wolf about
 * its own tooling is how the signal gets thrown away.
 *
 * So enforced rows are split: things the product serves, and things the product
 * does not serve and never asked for.
 *
 * Feature: relay-h0-mvp
 * Requirements: B21.2, B21.3, B21.4
 */

export interface ViolationRow {
  /** The blocked URI as the browser reported it. `inline` for inline script. */
  blocked: string | null;
  directive: string | null;
  document: string | null;
  n: string;
}

/**
 * Blocked origins that are NOT product code, each arguing for itself.
 *
 * The bar every allowlist in this directory uses: a justification under ~40
 * characters is decoration, and one that makes no checkable claim cannot be
 * reviewed. Keep this list SHORT — its purpose is to stop a known-innocent row
 * drowning a real one, and every entry added is a row that stops being read.
 */
export const NOT_PRODUCT_CODE: Readonly<Record<string, string>> = {
  'https://vercel.live/':
    'The Vercel toolbar, injected into the production origin for a signed-in Vercel user by a ' +
    'cookie — never served to a customer, and absent from the production HTML (verified ' +
    '2026-08-31). Blocking it is the policy working: it is a third party the product never asked ' +
    'for. If it ever needs to load, that is a decision to widen the policy, not a defect report.',
} as const;

export interface EnforcedSplit<T extends ViolationRow = ViolationRow> {
  /** Blocked things the product actually serves. These are defects. */
  productDefects: T[];
  /** Blocked third parties the product never asked for, with the reason each is here. */
  refusedThirdParty: { row: T; reason: string }[];
}

/*
  Generic over the caller's row type rather than narrowing to `ViolationRow`.
  `scripts/verify-csp.ts` reads richer rows (dispositions, timestamps) and prints
  them through its own formatter, so a split that returned the narrow type would
  force a cast at the call site — and a cast there is how a type error becomes a
  runtime surprise. It classifies on `blocked` and hands back exactly what it got.
*/
export function splitEnforced<T extends ViolationRow>(rows: T[]): EnforcedSplit<T> {
  const productDefects: T[] = [];
  const refusedThirdParty: { row: T; reason: string }[] = [];

  for (const row of rows) {
    const blocked = row.blocked ?? '';
    const hit = Object.entries(NOT_PRODUCT_CODE).find(([prefix]) => blocked.startsWith(prefix));
    if (hit) refusedThirdParty.push({ row, reason: hit[1] });
    else productDefects.push(row);
  }
  return { productDefects, refusedThirdParty };
}

/**
 * What does the report-only half say about taking the next rung?
 *
 * B21.2 exists so B21.3/B21.4 can be RULED, and the ruling turns on one
 * question: would tightening the policy break the product? An `inline`
 * violation answers yes and names the work — nonces or hashes — which is a
 * different decision from "flip the header".
 */
export function nextRungVerdict(wouldBlock: ViolationRow[]): {
  takeable: boolean;
  because: string;
} {
  if (wouldBlock.length === 0) {
    return {
      takeable: true,
      /*
        ⚠️ Zero has TWO meanings and this one is only safe because the caller
        prints the reports-are-arriving check alongside it. An empty table can
        mean "nothing violates the stricter policy" or "reports are not reaching
        the endpoint", and `scripts/verify-csp.ts` says so on every zero.
      */
      because:
        'nothing violated the stricter policy in this window — provided reports are actually ' +
        'arriving, which an empty table cannot distinguish on its own',
    };
  }

  const inline = wouldBlock.filter((r) => (r.blocked ?? '').toLowerCase() === 'inline');
  if (inline.length > 0) {
    return {
      takeable: false,
      because:
        `${inline.length} distinct INLINE script violation(s). Dropping 'unsafe-inline' blocks the ` +
        "framework's own bootstrap scripts, so the next rung needs nonces or hashes FIRST — that " +
        'is build work, not a header flip, and it is the thing B21.3/B21.4 are ruling on.',
    };
  }

  return {
    takeable: false,
    because:
      `${wouldBlock.length} distinct violation(s) would be blocked. Each needs an origin added to ` +
      'the policy or a dependency removed before the rung is takeable.',
  };
}
