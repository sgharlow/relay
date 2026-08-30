/**
 * Is the REQUEST LAYER covered, or is its shortfall being absorbed by `lib/`?
 *
 * 🔴 THE DEFECT THIS EXISTS FOR, measured 2026-08-30. `vitest.config.ts` enforces
 * thresholds over `lib/**` and `src/app/api/**` together. Those two are not the
 * same size: ~5,000 statements against ~1,600. So the blended figure read
 * 87.61% — comfortably over an 80 threshold — while the layer that decides who
 * is authenticated, what they may reach, and what status a refusal gets sat at
 * 66.15% statements and 59.17% branches, with 26 of 76 handlers executing no
 * test whatsoever. Nothing in CI was red at any point.
 *
 * Widening the scope in 2026-08-21 made the layer VISIBLE. It did not make it
 * MEASURED-ON-ITS-OWN, and an average is exactly the instrument that hides the
 * difference. This is the second number.
 *
 * ⚠️ IT READS THE REPORT, IT DOES NOT PRODUCE IT. `coverage/coverage-final.json`
 * is written by `npm run test:coverage`; this must run immediately after, in the
 * same job, which is how CI invokes it. Reading a stale report would be a green
 * about a run that never happened, so a report that does not describe the
 * request layer is refused as "could not look" rather than passed — see the
 * exit codes below.
 *
 * Exit codes, on the convention `verify:stripe` established:
 *   0 — the layer is at or above its floor
 *   1 — a FINDING: the layer is below its floor
 *   2 — COULD NOT LOOK: no report, unreadable, or it does not describe this layer
 *
 * The third is deliberately not the first. A missing coverage report is not a
 * pass.
 *
 *   npm run check:route-coverage
 *
 * Feature: relay-h0-mvp
 * Requirements: D8
 */

import { readFileSync, existsSync } from 'node:fs';

import { REQUEST_LAYER_FLOOR, REQUEST_LAYER_MIN_FILES } from '../lib/ops/coverage-scope';

const REPORT = 'coverage/coverage-final.json';

/** v8's per-file shape, narrowed to the two maps this reads. */
interface FileCoverage {
  s?: Record<string, number>;
  b?: Record<string, number[]>;
}

function pct(covered: number, total: number): number {
  // An empty layer is not 100% covered; it is unmeasurable, and the file-count
  // guard below is what turns that into a "could not look".
  return total === 0 ? 0 : (100 * covered) / total;
}

function main(): number {
  if (!existsSync(REPORT)) {
    console.error(
      `COULD NOT LOOK: ${REPORT} does not exist.\n` +
        `Run \`npm run test:coverage\` first — this reads that run's report, it does not produce one.`,
    );
    return 2;
  }

  let raw: Record<string, FileCoverage>;
  try {
    raw = JSON.parse(readFileSync(REPORT, 'utf8')) as Record<string, FileCoverage>;
  } catch (err) {
    console.error(`COULD NOT LOOK: ${REPORT} is not readable JSON — ${(err as Error).message}`);
    return 2;
  }

  let stmtsCovered = 0;
  let stmtsTotal = 0;
  let branchCovered = 0;
  let branchTotal = 0;
  const worst: Array<{ file: string; pct: number; n: number }> = [];

  for (const [absolute, entry] of Object.entries(raw)) {
    // v8 writes absolute paths, and on Windows they carry backslashes.
    const rel = absolute.split('\\').join('/').replace(/^.*?\/relay\//, '');
    if (!rel.startsWith(REQUEST_LAYER_FLOOR.prefix)) continue;

    let fileCovered = 0;
    let fileTotal = 0;
    for (const hits of Object.values(entry.s ?? {})) {
      fileTotal += 1;
      if (hits > 0) fileCovered += 1;
    }
    for (const arm of Object.values(entry.b ?? {})) {
      for (const hits of arm) {
        branchTotal += 1;
        if (hits > 0) branchCovered += 1;
      }
    }

    stmtsCovered += fileCovered;
    stmtsTotal += fileTotal;
    if (fileTotal > 0) worst.push({ file: rel, pct: pct(fileCovered, fileTotal), n: fileTotal });
  }

  if (worst.length < REQUEST_LAYER_MIN_FILES) {
    console.error(
      `COULD NOT LOOK: the report describes ${worst.length} file(s) under ` +
        `${REQUEST_LAYER_FLOOR.prefix}, which is fewer than the ${REQUEST_LAYER_MIN_FILES} this ` +
        `layer is expected to have.\nEither the coverage include globs changed, or the run was ` +
        `partial. Both mean this number is not about the request layer.`,
    );
    return 2;
  }

  const statements = pct(stmtsCovered, stmtsTotal);
  const branches = pct(branchCovered, branchTotal);

  console.log('request layer coverage — src/app/api/**, measured on its own\n');
  console.log(`  files            ${worst.length}`);
  console.log(
    `  statements       ${statements.toFixed(2)}%  (floor ${REQUEST_LAYER_FLOOR.statements}%)`,
  );
  console.log(
    `  branches         ${branches.toFixed(2)}%  (floor ${REQUEST_LAYER_FLOOR.branches}%)`,
  );

  const untested = worst.filter((w) => w.pct === 0);
  if (untested.length > 0) {
    console.log(`\n  ${untested.length} handler(s) execute no test at all:`);
    for (const u of untested) console.log(`    ${u.file}`);
  }

  const failures: string[] = [];
  if (statements < REQUEST_LAYER_FLOOR.statements) {
    failures.push(
      `statements ${statements.toFixed(2)}% is below the floor of ${REQUEST_LAYER_FLOOR.statements}%`,
    );
  }
  if (branches < REQUEST_LAYER_FLOOR.branches) {
    failures.push(
      `branches ${branches.toFixed(2)}% is below the floor of ${REQUEST_LAYER_FLOOR.branches}%`,
    );
  }

  if (failures.length > 0) {
    console.error(`\n::error::The request layer is below its own floor.`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      `\nThe answer is tests on the handlers that dropped, NEVER a smaller floor.\n` +
        `lib/ops/coverage-scope.ts records why: lowering a number so a newly-visible gap fits\n` +
        `inside it is how this guard became decorative the first time. The weakest handlers:`,
    );
    for (const w of [...worst].sort((a, b) => a.pct - b.pct).slice(0, 10)) {
      console.error(`  ${w.pct.toFixed(1).padStart(6)}%  n=${String(w.n).padStart(4)}  ${w.file}`);
    }
    return 1;
  }

  console.log('\nOK — the request layer carries its own weight.');
  return 0;
}

process.exit(main());
