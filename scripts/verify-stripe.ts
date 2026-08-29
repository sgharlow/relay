/**
 * scripts/verify-stripe.ts — is the billing contract still what the code and
 * `/terms` believe it is?
 *
 * Read-only. Two GETs against the Stripe API, no writes, no test objects, no
 * `stripe trigger`. The verdict logic is `lib/ops/stripe-wall.ts`, proven
 * without credentials; this file only supplies the live half, the same split
 * `verify-iam.ts` and `verify-kms.ts` use.
 *
 * WHAT IT CATCHES that nothing else does:
 *
 *   1. A handled webhook event the live endpoint is not subscribed to. That
 *      handler is DEAD IN PRODUCTION while passing every unit test — the exact
 *      state `invoice.payment_failed` was in from 2026-08-20 to 2026-08-29, and
 *      it was found by a person, twice.
 *   2. The default billing-portal configuration switching cancellation away from
 *      `at_period_end`. That is ACCOUNT-LEVEL on an account shared with
 *      skillcrossroads, report-bridge and second-brain: another product's
 *      operator can falsify `/terms` for Relay's customers in one click, in a
 *      dashboard this repo cannot see, with no commit and no deploy.
 *
 * ⚠️ TWO READ PATHS, AND ONLY ONE OF THEM CAN BE SCHEDULED.
 *
 *   `STRIPE_READONLY_KEY` — a RESTRICTED key with read permission on Webhook
 *   Endpoints and Billing Portal, which Steve mints. This is the schedulable
 *   path: it works on a runner, unattended, forever. Until it exists this script
 *   is a command somebody runs, which is the weakness this repo has a name for.
 *
 *   The paired Stripe CLI — the fallback, and what works today. It uses the
 *   session key in ~/.config/stripe/config.toml, which is a HUMAN pairing tied
 *   to Steve's browser and EXPIRES 2026-10-07 (E1.8). It cannot run on a runner
 *   and it is not a credential this script should ever try to renew.
 *
 * 🔴 NEVER give this a secret key. It needs to read two objects; a key that can
 * do more is a key that can do more on a SHARED live account. If the restricted
 * key cannot be minted narrowly, the CLI fallback is the better answer.
 *
 * Usage:
 *   npm run verify:stripe
 *
 * Exit codes, deliberately distinct — "the contract is broken" and "I could not
 * look" need different reactions, and collapsing them is how a monitor lies:
 *   0  contract holds
 *   1  a finding
 *   2  could not read (no key, no CLI pairing, API error)
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.7
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  checkEventContract,
  checkPortalContract,
  refundPolicyStillPromisesPeriodEnd,
  handlerCasesFrom,
  type Finding,
  type LiveEndpoint,
  type LivePortal,
} from '../lib/ops/stripe-wall';
import { REFUND_POLICY } from '../lib/offer';

/**
 * The endpoint id is pinned. Discovering it by listing would make the check
 * self-fulfilling: if the endpoint were replaced by a differently-configured
 * one, a list-and-pick would audit the new one and report health.
 */
const ENDPOINT_ID = 'we_1U2IIGGs40KMmT4XAIradLoE';
const ROUTE = 'src/app/api/stripe/webhook/route.ts';

class CannotLook extends Error {}

function viaApi<T>(path: string, key: string): Promise<T> {
  return fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${key}` },
  }).then(async (res) => {
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = body.error as { message?: string } | undefined;
      throw new CannotLook(`Stripe API ${res.status} on ${path}: ${err?.message ?? 'unknown'}`);
    }
    return body as T;
  });
}

function viaCli<T>(args: string[]): T {
  try {
    return JSON.parse(execFileSync('stripe', args, { encoding: 'utf8' })) as T;
  } catch (err) {
    throw new CannotLook(
      `\`stripe ${args.join(' ')}\` failed — is the CLI paired, and has the session key expired? ` +
        `(E1.8 dates it 2026-10-07.)\n  ${String(err).split('\n')[0]}`,
    );
  }
}

interface RawEndpoint {
  id: string;
  status: string;
  url: string;
  livemode: boolean;
  enabled_events: string[];
}

interface RawPortalList {
  data: Array<{
    id: string;
    is_default: boolean;
    active: boolean;
    features?: { subscription_cancel?: { enabled?: boolean; mode?: string } };
  }>;
}

async function readLive(): Promise<{ endpoint: LiveEndpoint; portal: LivePortal; how: string }> {
  const key = process.env.STRIPE_READONLY_KEY;

  const rawEndpoint = key
    ? await viaApi<RawEndpoint>(`webhook_endpoints/${ENDPOINT_ID}`, key)
    : viaCli<RawEndpoint>(['webhook_endpoints', 'retrieve', ENDPOINT_ID, '--live']);

  const rawPortals = key
    ? await viaApi<RawPortalList>('billing_portal/configurations?limit=100', key)
    : viaCli<RawPortalList>(['billing_portal', 'configurations', 'list', '--live', '--limit', '100']);

  /*
    Pick the DEFAULT configuration, and if there is none, hand back the first one
    with is_default false so `checkPortalContract` reports "the audited
    configuration is not the default" rather than this script guessing. A reader
    that silently picks something plausible is how a correct answer about the
    wrong object becomes a recorded fact.
  */
  const chosen = rawPortals.data.find((p) => p.is_default) ?? rawPortals.data[0];
  if (!chosen) throw new CannotLook('no billing portal configurations returned');

  return {
    how: key ? 'STRIPE_READONLY_KEY (schedulable)' : 'paired Stripe CLI (expires 2026-10-07 — E1.8)',
    endpoint: {
      id: rawEndpoint.id,
      status: rawEndpoint.status,
      url: rawEndpoint.url,
      livemode: rawEndpoint.livemode,
      enabledEvents: rawEndpoint.enabled_events ?? [],
    },
    portal: {
      id: chosen.id,
      isDefault: Boolean(chosen.is_default),
      active: Boolean(chosen.active),
      cancelEnabled: Boolean(chosen.features?.subscription_cancel?.enabled),
      cancelMode: chosen.features?.subscription_cancel?.mode ?? '(absent)',
    },
  };
}

async function main(): Promise<void> {
  let live: Awaited<ReturnType<typeof readLive>>;
  try {
    live = await readLive();
  } catch (err) {
    console.error(`\n✗ COULD NOT LOOK — this is not a passing check.\n  ${String(err instanceof Error ? err.message : err)}\n`);
    console.error('  Mint a restricted read-only key (Webhook Endpoints: read, Billing Portal: read)');
    console.error('  and set STRIPE_READONLY_KEY, or pair the CLI with `stripe login`.\n');
    process.exitCode = 2;
    return;
  }

  console.log(`verify:stripe — read via ${live.how}\n`);
  console.log(`  endpoint ${live.endpoint.id} → ${live.endpoint.url}`);
  console.log(`    status ${live.endpoint.status}, livemode ${live.endpoint.livemode}`);
  console.log(`    enabled_events: ${live.endpoint.enabledEvents.join(', ')}`);

  const handlerCases = handlerCasesFrom(readFileSync(ROUTE, 'utf8'));
  console.log(`  handler cases (${ROUTE}): ${handlerCases.join(', ')}`);
  console.log(`  portal ${live.portal.id} — default ${live.portal.isDefault}, active ${live.portal.active}`);
  console.log(`    cancel enabled ${live.portal.cancelEnabled}, mode ${live.portal.cancelMode}\n`);

  const findings: Finding[] = [
    ...checkEventContract(live.endpoint, handlerCases),
    ...checkPortalContract(live.portal),
    ...refundPolicyStillPromisesPeriodEnd(REFUND_POLICY),
  ];

  if (!findings.length) {
    console.log('✓ The billing contract holds. Both definitions agree, and /terms is true.\n');
    return;
  }

  console.log(`✗ ${findings.length} finding${findings.length === 1 ? '' : 's'}:\n`);
  for (const f of findings) {
    console.log(`  • ${f.rule}`);
    console.log(`    ${f.detail}`);
    console.log(`    → ${f.consequence}\n`);
  }
  process.exitCode = 1;
}

void main();
