/**
 * Accessibility audit — axe-core over the signed-in product.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/a11y-audit.mjs
 *
 * NOT A CI GATE, deliberately and for one reason: it needs a browser, and
 * Playwright is not a dependency of this repo. Wiring it into `npm test` would
 * mean either adding ~300MB of browser to every install or a test that silently
 * skips — and a check that skips is worse than one you have to remember, because
 * it reports green. Run it before a release and when a screen changes shape.
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
 * Serious and critical only. The point is defects somebody hits, not a score.
 */
const { chromium } = await import(
  'file:///C:/Users/sghar/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs'
);
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const BASE = 'http://localhost:3100';

const value = execFileSync(
  'npx',
  ['tsx', '--env-file=.env.local', 'scripts/mint-owner-session.ts', 'demo@relay.test'],
  { encoding: 'utf8', shell: true },
).split('\n').find((l) => l.startsWith('COOKIE ')).slice(7).trim();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([
  { name: 'next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  { name: '__Secure-next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
]);

const PAGES = ['/', '/caregivers', '/vault', '/circle', '/rules', '/triggers', '/approvals', '/account', '/audit', '/import'];

let total = 0;
for (const path of PAGES) {
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    await p.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(async () =>
      // Serious and critical only: the point is defects a person actually hits,
      // not a score to polish.
      await window.axe.run(document, { resultTypes: ['violations'] }),
    );
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    total += bad.length;
    console.log(`${path}  ${bad.length ? bad.length + ' serious/critical' : 'clean'}`);
    for (const v of bad) {
      console.log(`    ${v.id} (${v.impact}) x${v.nodes.length} — ${v.help}`);
      console.log(`      e.g. ${String(v.nodes[0].html).slice(0, 110)}`);
    }
  } catch (e) {
    console.log(`${path}  ERROR ${e.message.slice(0, 80)}`);
  }
  await p.close();
}
console.log(`\n${total} serious/critical violation type(s) across ${PAGES.length} pages`);
await browser.close();
