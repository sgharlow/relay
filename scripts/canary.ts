/**
 * Runs the production canary. Exits non-zero if any check fails, which is what
 * turns a silent breakage into a GitHub notification.
 *
 * Usage: node scripts/canary.ts [baseUrl]
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { CHECKS, evaluateCheck } from '../lib/ops/canary.ts';

const BASE = process.argv[2] ?? process.env.CANARY_BASE_URL ?? 'https://relaystandby.com';
const TIMEOUT_MS = 20_000;

async function main(): Promise<void> {
  console.log(`canary → ${BASE}\n`);
  const failures: string[] = [];

  for (const check of CHECKS) {
    let status = 0;
    let body = '';
    try {
      const res = await fetch(BASE + check.path, {
        method: check.method ?? 'GET',
        headers: check.contentType ? { 'content-type': check.contentType } : undefined,
        body: check.body,
        // Do NOT follow redirects. Every check here expects a terminal status
        // from the app itself, so a redirect means something is standing in
        // front of it. Following one turns a Vercel Deployment Protection wall
        // into a 200 from an SSO login page and the whole suite reads as
        // passing while never reaching the application at all — which is
        // exactly what happened the first time this was pointed at a preview.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      failures.push(`${check.name}: request failed — ${String(err)}\n    ${check.meaning}`);
      console.log(`  ✗ ${check.name} — request failed`);
      continue;
    }

    const result = evaluateCheck(check, { status, body });
    console.log(`  ${result.ok ? '✓' : '✗'} ${check.name} — ${result.detail}`);
    if (!result.ok) failures.push(`${check.name}: ${result.detail}\n    ${check.meaning}`);
  }

  if (failures.length === 0) {
    console.log(`\nAll ${CHECKS.length} checks passed.`);
    return;
  }

  console.log(`\n${failures.length} of ${CHECKS.length} checks FAILED:\n`);
  for (const f of failures) console.log(`  • ${f}\n`);
  process.exitCode = 1;
}

main();
