/**
 * Every rule in the Stripe contract wall, proven against a planted violation.
 *
 * The fixtures are copied VERBATIM from the live account, read read-only on
 * 2026-08-29 (`stripe webhook_endpoints retrieve we_1U2IIGGs40KMmT4XAIradLoE
 * --live` and `stripe billing_portal configurations list --live`), which is the
 * same discipline `iam-wall.test.ts` uses: a checker proven only against
 * hand-invented shapes is a checker proven against the author's imagination.
 *
 * ⚠️ And the fixtures are a SNAPSHOT, not an authority. They record what was true
 * on 2026-08-29 so the rules can be exercised without credentials; they say
 * nothing about today. `npm run verify:stripe` is the only thing that does.
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.7
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  TERMS_IMPLY_CANCEL_MODE,
  checkEventContract,
  checkPortalContract,
  refundPolicyStillPromisesPeriodEnd,
  handlerCasesFrom,
  type LiveEndpoint,
  type LivePortal,
} from './stripe-wall';
import { REFUND_POLICY } from '../offer';

/** Verbatim from the live account, 2026-08-29. */
const LIVE_ENDPOINT: LiveEndpoint = {
  id: 'we_1U2IIGGs40KMmT4XAIradLoE',
  status: 'enabled',
  url: 'https://relaystandby.com/api/stripe/webhook',
  livemode: true,
  enabledEvents: [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
  ],
};

/** Verbatim from the live account, 2026-08-29. */
const LIVE_PORTAL: LivePortal = {
  id: 'bpc_1Tu3WlGs40KMmT4X7RYjcEXF',
  isDefault: true,
  active: true,
  cancelEnabled: true,
  cancelMode: 'at_period_end',
};

const ROUTE = 'src/app/api/stripe/webhook/route.ts';

describe('the live shapes pass, which is the control', () => {
  it('the 2026-08-29 endpoint and handler agree', () => {
    const cases = handlerCasesFrom(readFileSync(ROUTE, 'utf8'));
    expect(checkEventContract(LIVE_ENDPOINT, cases)).toEqual([]);
  });

  it('the 2026-08-29 portal matches what /terms promises', () => {
    expect(checkPortalContract(LIVE_PORTAL)).toEqual([]);
  });

  /*
    A check that is happiest when the product is broken is measuring the wrong
    thing — the argument kms-wall.ts makes for asserting its positive half. So:
    the live REFUND_POLICY, as shipped, must still carry the clause the pin rests on.
  */
  it('the shipped REFUND_POLICY still makes the promise the pin rests on', () => {
    expect(refundPolicyStillPromisesPeriodEnd(REFUND_POLICY)).toEqual([]);
  });
});

describe('the event contract, proven by planted violation', () => {
  it('catches a handled event the endpoint will never send', () => {
    const narrowed: LiveEndpoint = {
      ...LIVE_ENDPOINT,
      enabledEvents: LIVE_ENDPOINT.enabledEvents.filter((e) => e !== 'invoice.payment_failed'),
    };
    const f = checkEventContract(narrowed, [...LIVE_ENDPOINT.enabledEvents]);

    expect(f).toHaveLength(1);
    expect(f[0].detail).toContain('invoice.payment_failed');
    expect(f[0].consequence).toMatch(/unreachable/);
  });

  /*
    This is the exact state the repo was in from 2026-08-20 to 2026-08-29, when
    nobody could say which of the two it was. It is planted here so the answer
    is never again "unknown from this repo".
  */
  it('is silent about an enabled event with no handler — noise, not a defect', () => {
    const widened: LiveEndpoint = {
      ...LIVE_ENDPOINT,
      enabledEvents: [...LIVE_ENDPOINT.enabledEvents, 'invoice.paid'],
    };
    expect(checkEventContract(widened, [...LIVE_ENDPOINT.enabledEvents])).toEqual([]);
  });

  it('catches a disabled endpoint', () => {
    const f = checkEventContract({ ...LIVE_ENDPOINT, status: 'disabled' }, []);
    expect(f.map((x) => x.rule)).toContain('endpoint is enabled');
  });

  it('catches a test-mode endpoint being audited as if it were live', () => {
    const f = checkEventContract({ ...LIVE_ENDPOINT, livemode: false }, []);
    expect(f.map((x) => x.rule)).toContain('endpoint is live-mode');
  });
});

describe('the portal contract, proven by planted violation', () => {
  it('catches the shared-account flip to immediate cancellation', () => {
    const f = checkPortalContract({ ...LIVE_PORTAL, cancelMode: 'immediately' });

    expect(f).toHaveLength(1);
    expect(f[0].detail).toContain('immediately');
    // The consequence must name the customer harm, not just the mismatch.
    expect(f[0].consequence).toMatch(/eleven months/);
    expect(f[0].consequence).toMatch(/shared with three other products/);
  });

  it('catches cancellation being switched off entirely', () => {
    const f = checkPortalContract({ ...LIVE_PORTAL, cancelEnabled: false });
    expect(f.map((x) => x.rule)).toContain('the portal offers cancellation at all');
  });

  /*
    The mode rule must NOT also fire here. Two findings for one cause is how an
    operator learns to skim — the same collapse the portfolio's SNS composite
    alarm was built for.
  */
  it('reports a disabled cancel control once, not twice', () => {
    const f = checkPortalContract({ ...LIVE_PORTAL, cancelEnabled: false, cancelMode: 'immediately' });
    expect(f).toHaveLength(1);
  });

  it('catches auditing a non-default configuration', () => {
    const f = checkPortalContract({ ...LIVE_PORTAL, isDefault: false });
    expect(f.map((x) => x.rule)).toContain('the audited portal configuration is the default one');
  });

  it('catches an inactive default configuration', () => {
    const f = checkPortalContract({ ...LIVE_PORTAL, active: false });
    expect(f.map((x) => x.rule)).toContain('the default portal configuration is active');
  });
});

describe('the pin cannot outlive the sentence it rests on', () => {
  it('fires when the promise is edited out of REFUND_POLICY', () => {
    const rewritten =
      'If Relay is not what you expected, email us within 30 days and we will refund it in full. ' +
      'Cancelling ends your access immediately.';
    const f = refundPolicyStillPromisesPeriodEnd(rewritten);

    expect(f).toHaveLength(1);
    expect(f[0].consequence).toContain(TERMS_IMPLY_CANCEL_MODE);
  });

  it('tolerates ordinary copy edits around the clause', () => {
    const reflowed = 'After that window we do not refund the unused part of a year, though you\ncan cancel  at any  time to stop the next one.';
    expect(refundPolicyStillPromisesPeriodEnd(reflowed)).toEqual([]);
  });
});

describe('the handler case list is read from source, not restated', () => {
  it('finds exactly the events the route handles', () => {
    const cases = handlerCasesFrom(readFileSync(ROUTE, 'utf8'));

    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases).toContain('invoice.payment_failed');
    expect(new Set(cases).size).toBe(cases.length);
  });

  it('reads a fall-through pair as two events, not one', () => {
    const src = [
      "      case 'customer.subscription.updated':",
      "      case 'customer.subscription.deleted': {",
      '        break;',
      '      }',
    ].join('\n');
    expect(handlerCasesFrom(src)).toEqual([
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]);
  });

  /*
    The false-positive direction. `api-reachability.ts` in this same directory
    shipped with a module-specifier false positive, so a source-scraping checker
    gets its non-matches asserted too.
  */
  it('does not mistake a quoted event name in prose or a switch on something else', () => {
    const src = [
      "// we may one day handle 'invoice.paid' here",
      "const label = 'checkout.session.completed';",
      "      case 'pending':",
      '      case 2:',
    ].join('\n');
    expect(handlerCasesFrom(src)).toEqual([]);
  });
});
