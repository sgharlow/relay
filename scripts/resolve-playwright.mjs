/**
 * Find Playwright, wherever this machine happens to keep it.
 *
 * 🔴 THE DEFAULT USED TO BE A PATH THAT EXISTS ON ONE LAPTOP. Both browser-driving
 * scripts resolved it as:
 *
 *   process.env.PLAYWRIGHT_MODULE ||
 *     `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`
 *
 * The escape hatch was real — `.github/workflows/a11y.yml` sets
 * `PLAYWRIGHT_MODULE: playwright` after an `npm i --no-save`, which is why the
 * accessibility job works — but the DEFAULT was a sibling directory of a
 * particular checkout on a particular computer. On a clean clone, on the other
 * PC, or in any job that forgets that env var, `e2e-ui.ts` fails at the import
 * with `ERR_MODULE_NOT_FOUND` naming somebody's home directory.
 *
 * That matters more than it sounds. `e2e-ui` is the ONLY functional browser walk
 * in this repository: `verify:live`'s other four walks drive HTTP, and the walk's
 * own header explains why that is not enough — "a guard that refuses correctly
 * and a prompt nobody can answer look identical over HTTP". So the one check
 * that can tell those apart was reachable from one machine.
 *
 * ⚠️ THE ORDER IS THE DESIGN, and each rung earns its place:
 *
 *   1. `PLAYWRIGHT_MODULE` — an explicit override always wins. This is what CI
 *      already sets, so nothing that works today stops working.
 *   2. the bare specifier `playwright` — resolves from `node_modules` after
 *      `npm i --no-save playwright`, which is the pattern a11y.yml has already
 *      proven on a runner. This is the rung that makes a clean checkout work.
 *   3. the shared-tools path — kept, and kept LAST. It is why this laptop needs
 *      no install, and putting it after the bare specifier means a locally
 *      installed Playwright wins over a shared one rather than being shadowed
 *      by it.
 *
 * ⚠️ AND IT IS DELIBERATELY NOT A DEPENDENCY. a11y.yml states the trade and
 * declining it is still right: Playwright is a harness, not a dependency of the
 * product, and adding ~300MB to every developer's install to serve two scripts
 * is a bad bargain. What was wrong was letting that decision mean the default
 * path is one person's home directory.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the walks half)
 */

/** The install that makes rung 2 work. Quoted in the error, so it is one copy. */
export const INSTALL_HINT = 'npm i --no-save playwright && npx playwright install chromium';

/** Where this laptop keeps a shared copy, so no install is needed here. */
export function sharedToolsSpecifier() {
  const home = (process.env.HOME || process.env.USERPROFILE || '')
    .split(String.fromCharCode(92))
    .join('/');
  if (!home) return null;
  return `file:///${home}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;
}

/** The rungs, in order, with the override first. Exported so a test can read them. */
export function candidates() {
  const out = [];
  if (process.env.PLAYWRIGHT_MODULE) out.push(process.env.PLAYWRIGHT_MODULE);
  out.push('playwright');
  const shared = sharedToolsSpecifier();
  if (shared) out.push(shared);
  return out;
}

/**
 * Import Playwright, or fail with something a person can act on.
 *
 * ⚠️ A MODULE THAT LOADS BUT HAS NO `chromium` COUNTS AS A FAILURE, not a
 * success. Otherwise a stub, a wrong package, or a partially-installed copy
 * resolves here and the walk dies later with `chromium is not a function`,
 * pointing at the browser rather than at the install.
 */
export async function resolvePlaywright() {
  const tried = [];
  for (const specifier of candidates()) {
    try {
      const mod = await import(specifier);
      if (mod && typeof mod.chromium?.launch === 'function') return mod;
      tried.push(`${specifier} — loaded, but exports no usable chromium`);
    } catch (err) {
      tried.push(`${specifier} — ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }
  }
  throw new Error(
    'Playwright could not be resolved. Tried, in order:\n' +
      tried.map((t) => `  ${t}`).join('\n') +
      `\n\nInstall it for this checkout:\n  ${INSTALL_HINT}\n` +
      'or set PLAYWRIGHT_MODULE to a specifier that resolves. It is deliberately not a ' +
      'dependency of this project — a browser harness is not part of the product.',
  );
}
