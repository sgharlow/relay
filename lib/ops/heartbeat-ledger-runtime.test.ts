/**
 * The heartbeat's ledger write has to work under the RUNTIME THE SCHEDULED TASK USES,
 * not only under vitest.
 *
 * 🔴 WHAT HAPPENED. `sendOperatorAlert` records what it sends through a dynamic
 * `import('./delivery-events')` (0b7cd43, 2026-09-03). vitest resolves that; Node's
 * own loader — which is what `npm run heartbeat` started (`node … scripts/heartbeat-local.ts`,
 * native type stripping, Node 22) — does not: ESM relative imports need an extension, and
 * `delivery-events.ts` then imports `../db/connection` the same way. So every real alert
 * logged `[heartbeat] alert sent but not recorded: Error [ERR_MODULE_NOT_FOUND]` to
 * `.heartbeat/task.log` (2026-09-14 12:39Z, 12:54Z, 13:09Z — three alerts, three orphan
 * delivery events, and `/api/health/delivery-webhook` read `mute` for eleven days). The
 * fix that was meant to end the false positive had never executed where it mattered.
 *
 * The cure is the runner, not a trail of `.ts` suffixes through lib/: every other script
 * in package.json already runs under `tsx`, which resolves extensionless imports exactly as
 * vitest and Next do. This test pins two things: the `heartbeat` script uses that runner,
 * and — spawned under WHATEVER runner the script names — importing `operator-alert.ts` and
 * sending one stubbed alert reaches the ledger code without a module-resolution failure.
 * (Without DSQL env the ledger write itself fails AFTER resolution with a "DSQL_PRIMARY_ENDPOINT
 * is not set" line; that is the recorder's own best-effort path and is not what this guards.)
 *
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const heartbeat = pkg.scripts.heartbeat ?? '';

describe('heartbeat ledger under the scheduled task runtime', () => {
  it('the heartbeat script runs under tsx, the runner every other script uses', () => {
    expect(heartbeat, 'package.json scripts.heartbeat').toMatch(/^npx tsx\b/);
    expect(heartbeat).toContain('scripts/heartbeat-local.ts');
  });

  // Spawning `npx tsx` cold takes ~10 s on Windows; vitest's default 5 s would time out.
  it('under that runner, sendOperatorAlert reaches the ledger without ERR_MODULE_NOT_FOUND', { timeout: 120_000 }, () => {
    // The runner is whatever precedes the script path — `npx tsx <node flags>` after the fix,
    // `node <node flags>` before it. Spawned exactly as the task would spawn it.
    const runner = heartbeat.replace(/\s*scripts\/heartbeat-local\.ts.*$/, '').split(/\s+/).filter(Boolean);
    const [cmd, ...args] = runner.filter((a) => !a.startsWith('--env-file'));
    const mod = pathToFileURL(resolve(ROOT, 'lib', 'notify', 'operator-alert.ts')).href;
    const code = [
      `const m = await import(${JSON.stringify(mod)});`,
      `const ok = await m.sendOperatorAlert(`,
      `  { apiKey: 'k', from: 'a@relaystandby.com', to: 'b@example.com', subject: 's', text: 't' },`,
      `  { fetchImpl: async () => new Response(JSON.stringify({ id: 'ledger-runtime-probe' }), { status: 200, headers: { 'content-type': 'application/json' } }) },`,
      `);`,
      `console.log('SENT=' + ok);`,
    ].join('\n');
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(DSQL_|AWS_)/.test(k)) delete env[k]; // no database, on purpose
    // A temp file rather than `-e`: a multi-line -e argument does not survive the Windows shell,
    // and the scheduled task runs on Windows.
    const probe = join(tmpdir(), `relay-ledger-runtime-probe-${process.pid}.mjs`);
    writeFileSync(probe, code + '\n');
    let r: ReturnType<typeof spawnSync>;
    try {
      r = spawnSync(cmd, [...args, probe], {
        cwd: ROOT, env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000,
      });
    } finally {
      rmSync(probe, { force: true });
    }
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out, out).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/);
    expect(r.stdout, out).toContain('SENT=true');
  });
});
