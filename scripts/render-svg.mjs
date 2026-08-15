/**
 * scripts/render-svg.mjs — rasterise a committed SVG to PNG at exact pixels.
 *
 *   node scripts/render-svg.mjs docs/ad-assets/avatar-400.svg 400 400
 *
 * WHY THIS EXISTS RATHER THAN AN IMAGE MODEL. `docs/ad-assets/PROMPTS.md` says
 * it for the avatar: "Faster and exact: render src/app/icon.svg at 400 × 400
 * instead of generating it… The SVG is the authoritative mark." An image model
 * asked to reproduce an existing logo returns something that RESEMBLES it, and
 * a brand mark that resembles itself is a different mark. Ad platforms want a
 * PNG; the repo has the vector; this is the two-minute bridge.
 *
 * Uses the same headless Chromium the E2E walks use, so it needs no new
 * dependency and no native image toolchain — which on this Windows workstation
 * is worth avoiding.
 *
 * Feature: relay-h0-mvp (G1)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [input, wArg, hArg] = process.argv.slice(2);
if (!input) {
  console.error('usage: node scripts/render-svg.mjs <file.svg> [width] [height]');
  process.exit(1);
}

const width = Number(wArg ?? 400);
const height = Number(hArg ?? width);
const output = resolve(input.replace(/\.svg$/i, '.png'));

const HOME = (process.env.USERPROFILE || process.env.HOME || '').split('\\').join('/');
const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ||
  `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;

const svg = readFileSync(resolve(input), 'utf8');

const { chromium } = await import(PLAYWRIGHT);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width, height },
    // Rasterise at 1:1. A device scale factor would silently produce a file
    // twice the dimensions the ad platform validates against.
    deviceScaleFactor: 1,
  });

  // Transparent-safe: the SVG paints its own ground, and margin:0 keeps the
  // rasterised box exactly the requested size.
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;line-height:0">${svg}</body></html>`,
    { waitUntil: 'load' },
  );

  await page.screenshot({ path: output, omitBackground: true });
  console.log(`[render] ${input} → ${output} (${width}×${height})`);
} finally {
  await browser.close();
}
