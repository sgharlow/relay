/**
 * Runs the production canary. Exits non-zero if any check fails, which is what
 * turns a silent breakage into a GitHub notification.
 *
 * Usage: node scripts/canary.ts [baseUrl]
 *
 * The loop lives in lib/ops/canary-run.ts so the cloud heartbeat runs the same
 * checks the same way (2026-10-20).
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { runCanary } from '../lib/ops/canary-run.ts';

const BASE = process.argv[2] ?? process.env.CANARY_BASE_URL ?? 'https://relaystandby.com';

async function main(): Promise<void> {
  const run = await runCanary(BASE);
  console.log(run.output);
  if (!run.ok) process.exitCode = 1;
}

main();
