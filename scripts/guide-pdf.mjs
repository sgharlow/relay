/**
 * Print the user's guide to the PDF that ships beside it.
 *
 * 🔴 THE TWO WERE ABLE TO DRIFT, and nothing would have said so. The guide is
 * shipped twice — `public/guide/index.html`, linked from /help and named in
 * invitations, and `public/guide/relay-guide.pdf`, offered because the wedge is
 * elderly owners and "a guide you can put in the drawer" is a real request. The
 * HTML was edited by hand and the PDF was generated once, so any change to the
 * document updated one copy and silently left the other describing an older
 * product. That is the same one-artifact-two-copies failure the repo has now
 * hit several times; this makes the PDF derived rather than remembered.
 *
 * Run it whenever index.html changes:
 *   node scripts/guide-pdf.mjs            # needs a server on :3100
 *   GUIDE_BASE=https://relaystandby.com node scripts/guide-pdf.mjs
 *
 * IT PRINTS THE SERVED PAGE, not the file, because the guide's images are
 * root-absolute (`/guide/screens/...`). Opening index.html over file:// would
 * resolve those against the filesystem root and produce a PDF of a document
 * with 26 broken images — which is exactly the defect the absolute paths were
 * introduced to fix, arriving by another door.
 */

import { writeFileSync, statSync } from 'node:fs';

/*
  Playwright lives in the shared toolbox rather than this repo, and is resolved
  from $HOME rather than a literal username — same as scripts/a11y-audit.mjs,
  and for the same reason: a hardcoded C:/Users/<someone> path is unrunnable for
  anybody else and is banned by the portfolio's own rule.
*/
const HOME = (process.env.HOME || process.env.USERPROFILE || '').split('\\').join('/');
const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ||
  `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;
const { chromium } = await import(PLAYWRIGHT);

const BASE = process.env.GUIDE_BASE || 'http://localhost:3100';
const OUT = 'public/guide/relay-guide.pdf';

const browser = await chromium.launch();
const page = await browser.newPage();

/** Images that 404 must fail the run, not quietly print as gaps. */
const missing = [];
page.on('response', (r) => {
  if (r.status() >= 400 && /\.(png|jpe?g|svg|webp)$/i.test(new URL(r.url()).pathname)) {
    missing.push(`${r.status()} ${new URL(r.url()).pathname}`);
  }
});

await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });

// Every <img> decoded before printing. `networkidle` says the requests finished;
// it does not say the bitmaps are ready to paint, and a PDF captured a beat too
// early loses images with no error anywhere.
//
// 🔴 LAZY IMAGES FIRST, or this waits forever. The guide's images carry
// `loading="lazy"`, and Chromium defers a lazy image that never approaches the
// viewport — including its `decode()` promise, which simply never settles for
// an image whose fetch has not been triggered. A print run never scrolls, so
// from 2026-08-17 (Playwright's bundled Chromium of that week) this script hung
// on the await below with no output and no error. Flipping every image to
// eager before decoding starts the fetches the print needs anyway.
const decoded = await page.evaluate(async () => {
  const imgs = [...document.images];
  for (const i of imgs) i.loading = 'eager';
  await Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => null))));
  return { total: imgs.length, broken: imgs.filter((i) => !i.naturalWidth).length };
});

if (missing.length) {
  console.error('FAILED — assets did not load:\n  ' + missing.join('\n  '));
  await browser.close();
  process.exit(1);
}
if (decoded.broken > 0) {
  console.error(`FAILED — ${decoded.broken} of ${decoded.total} images did not render.`);
  await browser.close();
  process.exit(1);
}

const pdf = await page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
});
writeFileSync(OUT, pdf);
await browser.close();

console.log(`${OUT} — ${decoded.total} images, ${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
