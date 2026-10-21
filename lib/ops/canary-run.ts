/**
 * Runs the canary's CHECKS against a base URL and returns what `scripts/canary.ts`
 * prints. One loop, three callers: the GitHub workflow (via scripts/canary.ts),
 * the local heartbeat (which runs that script), and the cloud heartbeat
 * (lib/ops/heartbeat-cloud.ts, an AWS Lambda since 2026-10-20).
 *
 * The output's line shape is a contract: `productionKey` (heartbeat-alert.ts)
 * reads `  ✗ <name> — ` to give a failure a stable identity, so an unchanged
 * problem is mailed once rather than every tick. canary-run.test.ts holds it.
 *
 * Imports only ./canary.ts: scripts/canary.ts is run by bare `node` with no
 * installed dependencies, so the alarm cannot be stopped by a broken lockfile.
 *
 * Feature: relay-h0-mvp (CC9, B12.i)
 */

import { CHECKS, evaluateCheck, type CanaryCheck } from './canary.ts';

export interface CanaryRun {
  ok: boolean;
  /** Exactly what scripts/canary.ts prints. */
  output: string;
  failures: string[];
}

export interface CanaryRunOptions {
  fetchImpl?: typeof fetch;
  checks?: CanaryCheck[];
  timeoutMs?: number;
}

export async function runCanary(base: string, opts: CanaryRunOptions = {}): Promise<CanaryRun> {
  const doFetch = opts.fetchImpl ?? fetch;
  const checks = opts.checks ?? CHECKS;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const lines: string[] = [`canary → ${base}\n`];
  const failures: string[] = [];

  for (const check of checks) {
    let status = 0;
    let body = '';
    try {
      const res = await doFetch(base + check.path, {
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
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      failures.push(`${check.name}: request failed — ${String(err)}\n    ${check.meaning}`);
      lines.push(`  ✗ ${check.name} — request failed`);
      continue;
    }

    const result = evaluateCheck(check, { status, body });
    lines.push(`  ${result.ok ? '✓' : '✗'} ${check.name} — ${result.detail}`);
    if (!result.ok) failures.push(`${check.name}: ${result.detail}\n    ${check.meaning}`);
  }

  if (failures.length === 0) {
    lines.push(`\nAll ${checks.length} checks passed.`);
  } else {
    lines.push(`\n${failures.length} of ${checks.length} checks FAILED:\n`);
    for (const f of failures) lines.push(`  • ${f}\n`);
  }
  return { ok: failures.length === 0, output: lines.join('\n'), failures };
}
