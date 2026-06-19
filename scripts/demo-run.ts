/**
 * Demo run script (task 33.2) — documents the four demo moments as executable
 * steps against a deployed Relay instance. Run: `npx tsx scripts/demo-run.ts`.
 *
 * Requires:
 *   RELAY_BASE_URL       — e.g. https://<preview>.vercel.app
 *   RELAY_OWNER_COOKIE   — an authenticated demo-owner session cookie
 *   (optional) DSQL_USE_SECONDARY toggling is done via Vercel env, not here.
 *
 * The four demo moments (design.md):
 *   1. Reversible emergency flow end-to-end (simulate)
 *   2. Live region failover (DSQL_USE_SECONDARY) — manual env flip, verified here
 *   3. OCC correctness — two concurrent simulates, only one advances
 *   4. Importance moment — Gmail first in the access dashboard with risk graph
 *
 * Feature: relay-h0-mvp
 * Requirements: demo spine validation
 */

const BASE = process.env.RELAY_BASE_URL;
const COOKIE = process.env.RELAY_OWNER_COOKIE ?? '';

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main(): Promise<void> {
  if (!BASE) throw new Error('RELAY_BASE_URL is not set');

  // Moment 1 — reversible emergency flow: simulate ARMED→PENDING→GRACE→RELEASED.
  log('Moment 1: simulate emergency trigger (≤10s)…');
  const sim = await post('/api/demo/simulate', { trigger_type: 'emergency' });
  log(`  → ${sim.status} ${JSON.stringify(await sim.json())}`);

  // Moment 3 — OCC correctness: two concurrent simulates, only one should advance.
  log('Moment 3: two concurrent simulates — expect exactly one success…');
  const [a, b] = await Promise.all([
    post('/api/demo/simulate', { trigger_type: 'emergency' }),
    post('/api/demo/simulate', { trigger_type: 'emergency' }),
  ]);
  log(`  → statuses ${a.status}, ${b.status} (one 200, one 409 expected)`);

  // Moment 2 — failover: flip DSQL_USE_SECONDARY in Vercel env, then re-read.
  log('Moment 2: set DSQL_USE_SECONDARY=true in Vercel env, then reload the');
  log('  recipient access dashboard — data should still load from us-west-2.');

  // Moment 4 — importance: Gmail appears first in the access dashboard with a
  // "gates N resets" risk-graph tooltip (verify visually in the Access UI).
  log('Moment 4: open the recipient access dashboard — Gmail ranks first with');
  log('  its risk-graph reveal (bank items depend on it).');
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
