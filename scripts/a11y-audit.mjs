/**
 * Accessibility audit — axe-core over the rendered product.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/a11y-audit.mjs
 *
 * Exits non-zero when anything serious or critical is found, so CI can gate on
 * it (.github/workflows/a11y.yml).
 *
 * 🔴 IT REPLACES A HEURISTIC THAT LIED. An earlier regex sweep reported 24
 * unnamed form controls. Every one was wrong: `[^>]*` stops at the `>` inside
 * `onChange={(e) => ...}`, so it never reached the aria-label that followed.
 * Spot-checking one control disproved the whole run. axe evaluates the rendered
 * accessibility tree, which is the only thing that can answer this question —
 * and on its first run it found two REAL critical defects the regex had missed
 * entirely: an unnamed <select> on /circle and two unlabelled quorum inputs on
 * /triggers. Both fixed 2026-08-13.
 *
 * 🔴 IT USED TO AUDIT THE WRONG HALF OF THE PRODUCT. Until 2026-08-13 the page
 * list was ten owner-mode and landing routes — and CC8, the requirement this
 * script exists to enforce, names ACCESS MODE specifically: "elderly owners and
 * recipients operating under acute stress ... minimum 18px body text in Access
 * mode". Every screen a recipient, a standby contact or a verifier actually
 * sees was outside the audit. The pre-release audit found this alongside 134
 * hardcoded hex colours in those same files, which lib/ops/contrast.test.ts
 * cannot see either because it reads only the token declarations in
 * globals.css. Between the two checks, the mode the requirement is about was
 * covered by neither.
 *
 * CONTACT PAGES ARE AUDITED SIGNED OUT, ON A PHONE-SIZED VIEWPORT. That is the
 * only honest fidelity: a recipient is not the owner and does not hold the
 * owner's cookie, and J8 specifies this experience as happening on a phone at
 * 2am. Auditing them inside an owner session would measure a state no contact
 * is ever in.
 *
 * Serious and critical only. The point is defects somebody hits, not a score.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

/*
  Playwright lives in the shared toolbox rather than this repo — see the note on
  CI gating below. Resolved from $HOME, never a literal username: a hardcoded
  C:/Users/<someone> path is unrunnable for anyone else and is banned by the
  portfolio's own rule.
*/
const HOME = (process.env.HOME || process.env.USERPROFILE || '').split('\\').join('/');
const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ||
  `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;
const { chromium } = await import(PLAYWRIGHT);

const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const BASE = process.env.A11Y_BASE || 'http://localhost:3100';

/** Owner mode — dense, 16px floor, behind a session. */
const OWNER_PAGES = [
  '/vault',
  '/circle',
  '/rules',
  '/triggers',
  '/approvals',
  '/account',
  '/audit',
  '/import',
];

/**
 * Everything a person who is NOT the owner can reach. The contact screens are
 * the CC8 audience; the public ones are where somebody frightened by an email
 * lands before they are anybody at all.
 */
const PUBLIC_PAGES = [
  '/',
  '/caregivers',
  '/how-it-works',
  '/security',
  '/help',
  '/terms',
  '/privacy',
  '/claim',
  '/access',
  '/break-glass',
  '/verify',
  '/standby',
  '/helping',
  // Drifted-in additions (2026-08-13): the guided demo, the sign-in surfaces —
  // the elderly wedge's very first screens — and the G1 interest form.
  '/demo',
  '/auth/signin',
  '/auth/signup',
  '/auth/recover',
  '/caregivers/interest',
];

/**
 * `public` audits only what a signed-out person can reach; `all` adds owner
 * mode and needs database credentials to mint a session.
 *
 * CI RUNS `public`, AND SAYS SO IN ITS OUTPUT. GitHub Actions holds no DSQL
 * credentials, so owner mode genuinely cannot be audited there. The honest
 * handling is to name what was not covered on every run — the alternative, a
 * silent skip, reports green over pages nobody opened, which is the exact
 * failure this file's header spends a paragraph arguing against.
 */
const SCOPE = process.env.A11Y_SCOPE || 'all';

/**
 * Whose session to audit owner mode in.
 *
 * 🔴 IT WAS HARDCODED TO `demo@relay.test`, AND THAT ACCOUNT NO LONGER EXISTS —
 * so from some point before 2026-08-15 this script silently stopped auditing
 * owner mode entirely and fell into the skip branch below on every run. The
 * skip is loud, which is the only reason it was noticeable at all; what it
 * could not say was that the cause was a fixable one-line assumption rather
 * than a missing credential. CC8 still records axe as clean across 21 pages
 * from the 2026-08-13 run; this was measuring 18.
 *
 * A disposable owner created through the ordinary signup API and deleted after
 * is the practice the production sweeps already use, and it needs this to be a
 * parameter.
 */
const OWNER_EMAIL = process.env.A11Y_OWNER_EMAIL || 'demo@relay.test';

let ownerCtx = null;
let ownerSkipReason = SCOPE === 'public' ? 'A11Y_SCOPE=public' : null;

const browser = await chromium.launch();

if (!ownerSkipReason) {
  try {
    const value = execFileSync(
      'npx',
      ['tsx', '--env-file=.env.local', 'scripts/mint-owner-session.ts', OWNER_EMAIL],
      { encoding: 'utf8', shell: true },
    )
      .split('\n')
      .find((l) => l.startsWith('COOKIE '))
      .slice(7)
      .trim();
    ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ownerCtx.addCookies([
      { name: 'next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
      { name: '__Secure-next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
    ]);
  } catch (e) {
    ownerSkipReason =
      `could not mint an owner session for ${OWNER_EMAIL} ` +
      `(${e.message.split('\n')[0].slice(0, 60)}). Set A11Y_OWNER_EMAIL to an ` +
      `account that exists — scripts/disposable-owner.ts makes one`;
  }
}

/*
  390x844 is an iPhone-ish portrait. Access mode's whole claim is that it works
  for somebody standing in a hospital corridor, and a 1280px desktop viewport
  cannot test that claim — it hides exactly the overflow and tap-target defects
  that audience meets first.
*/
const publicCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });

let total = 0;
let audited = 0;

async function audit(ctx, path, label) {
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    /*
      A REDIRECT SCORED AS THE PAGE YOU ASKED FOR IS A FALSE GREEN. If /standby
      bounced a signed-out reader to /auth/signin, axe would audit the sign-in
      page and this script would print "/standby clean" — a clean result for a
      screen it never opened. Checked rather than assumed: it happens not to
      redirect today, and "today" is not a guarantee.
    */
    const landed = new URL(p.url()).pathname;
    if (landed !== path) {
      total += 1;
      console.log(`${label.padEnd(9)} ${path.padEnd(16)} REDIRECTED to ${landed} — not audited`);
      await p.close();
      return;
    }
    await p.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(async () => await window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    total += bad.length;
    audited += 1;
    console.log(`${label.padEnd(9)} ${path.padEnd(16)} ${bad.length ? bad.length + ' serious/critical' : 'clean'}`);
    for (const v of bad) {
      console.log(`    ${v.id} (${v.impact}) x${v.nodes.length} — ${v.help}`);
      console.log(`      e.g. ${String(v.nodes[0].html).slice(0, 110)}`);
    }
  } catch (e) {
    /*
      An unreachable page is a FAILURE, not a skip. A silent skip is how a
      check reports green over a page it never opened — the failure mode this
      whole file exists to argue against.
    */
    total += 1;
    console.log(`${label.padEnd(9)} ${path.padEnd(16)} ERROR ${e.message.slice(0, 80)}`);
  }
  await p.close();
}

/*
  Owner mode on a PHONE as well as a desktop.

  🔴 IT WAS AUDITED AT 1280 ONLY, and a 1280px viewport cannot see the two
  defect classes that actually bite: horizontal overflow, and the touch-target
  rule in globals.css — which applies under `(max-width: 720px), (pointer:
  coarse)` and therefore does not even RUN in the desktop pass. That rule turns
  every button into `inline-flex`, and on 2026-08-15 it silently laid an option
  out sideways on the access picker; the desktop render of the same component
  was perfect. A pass that never triggers a rule cannot test what the rule does.

  Owner mode is written as dense desktop-first, and its audience is still the
  fifty-something adult child setting this up — often on the phone in their
  hand. Both viewports, or the claim is only about one of them.
*/
const ownerPhoneCtx = ownerCtx
  ? await (async () => {
      const value = (await ownerCtx.cookies()).find((c) => c.name.includes('session-token'))?.value;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      if (value) {
        await ctx.addCookies([
          { name: 'next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
        ]);
      }
      return ctx;
    })()
  : null;

for (const path of PUBLIC_PAGES) await audit(publicCtx, path, 'signed-out');
if (ownerCtx) for (const path of OWNER_PAGES) await audit(ownerCtx, path, 'owner');
if (ownerPhoneCtx) for (const path of OWNER_PAGES) await audit(ownerPhoneCtx, path, 'owner:390');

const expected =
  PUBLIC_PAGES.length + (ownerCtx ? OWNER_PAGES.length : 0) + (ownerPhoneCtx ? OWNER_PAGES.length : 0);
console.log(`\n${total} serious/critical violation type(s) across ${audited} pages`);

if (ownerSkipReason) {
  console.log(
    `\nNOT AUDITED: owner mode (${OWNER_PAGES.length} pages) — ${ownerSkipReason}.\n` +
      'This run says nothing about those screens. Run it locally with database\n' +
      'credentials before a release; CI covers the signed-out half only.',
  );
}

await browser.close();

if (audited !== expected) {
  console.log(`REACHED ${audited} OF ${expected} PAGES — treat this run as a failure.`);
  process.exit(1);
}
process.exit(total > 0 ? 1 : 0);
