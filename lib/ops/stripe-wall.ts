/**
 * The Stripe contract wall — two definitions of the same thing, kept in sync by
 * nobody until now.
 *
 * Pure verdict logic, in the shape `iam-wall.ts` and `kms-wall.ts` established:
 * every rule is decidable from plain data, so each one is proven against a
 * planted fixture with no credentials and no network. `scripts/verify-stripe.ts`
 * supplies the live half.
 *
 * WHY THIS IS A CLASS AND NOT AN INCIDENT. `docs/stripe-setup.md` states it
 * outright: "the handler's event list and the endpoint's event list are two
 * definitions of the same contract, kept in sync by nobody. The next handler
 * added will have the same gap on the same day it ships." That already happened
 * once — `invoice.payment_failed` became a handled case on 2026-08-20, and
 * whether the live endpoint would ever POST it was unknown until 2026-08-29:
 * nine days in which `lib/billing/lapse-notice.ts` might have been unreachable
 * in production no matter how correct the code was. Both times it was found by
 * a person looking, which is the thing this repo keeps deciding is not good
 * enough.
 *
 * THE SHARED-ACCOUNT RULE IS THE SHARPER ONE. This Stripe account is shared with
 * skillcrossroads, report-bridge and second-brain. The default billing-portal
 * configuration is ACCOUNT-LEVEL: another product's operator can switch
 * cancellation from `at_period_end` to `immediately` in one click, in a dashboard
 * this repo cannot see, and `/terms` — which promises "cancel at any time to stop
 * the next one" — silently becomes a false statement made to paying customers.
 * No commit, no test, no deploy, no alarm. A wall nothing re-measures is a wall
 * that can be moved by someone who does not know it is a wall.
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.7
 */

/** What the live endpoint says it will send us. */
export interface LiveEndpoint {
  id: string;
  status: string;
  url: string;
  livemode: boolean;
  enabledEvents: string[];
}

/** The account-level default portal configuration. */
export interface LivePortal {
  id: string;
  isDefault: boolean;
  active: boolean;
  cancelEnabled: boolean;
  /** Stripe's own vocabulary: `at_period_end` | `immediately`. */
  cancelMode: string;
}

export interface Finding {
  rule: string;
  detail: string;
  /** What it costs. Every contract entry in this repo carries one. */
  consequence: string;
}

/**
 * The cancellation mode `/terms` promises.
 *
 * `lib/offer.ts -> REFUND_POLICY` says "you can cancel at any time to stop the
 * next one", whose plain reading is: the current period runs out, and there is
 * no further charge. That is `at_period_end`. Pinned as a constant rather than
 * inferred from the prose, because a checker that parses marketing copy is a
 * checker that breaks on a comma — but see `refundPolicyStillPromisesPeriodEnd`
 * below, which closes the other half of that trade.
 */
export const TERMS_IMPLY_CANCEL_MODE = 'at_period_end';

/** The endpoint must be able to send everything the handler is prepared to act on. */
export function checkEventContract(endpoint: LiveEndpoint, handlerCases: string[]): Finding[] {
  const findings: Finding[] = [];

  if (endpoint.status !== 'enabled') {
    findings.push({
      rule: 'endpoint is enabled',
      detail: `status is ${JSON.stringify(endpoint.status)}`,
      consequence:
        'Stripe sends nothing at all. Every billing state change is invisible to the product: ' +
        'subscriptions never activate, lapses never notify, cancellations never close access.',
    });
  }

  if (!endpoint.livemode) {
    findings.push({
      rule: 'endpoint is live-mode',
      detail: `livemode is ${endpoint.livemode}`,
      consequence:
        'The audited endpoint is not the one real customers touch, so every other verdict here ' +
        'is a statement about a test fixture.',
    });
  }

  /*
    The direction that matters. A handled case with no matching enabled event is
    DEAD CODE IN PRODUCTION that looks alive in every test — the exact shape of
    the `invoice.payment_failed` gap. The reverse (an enabled event with no case)
    is noisy but harmless: it falls to `default: break`. Asymmetric on purpose;
    a rule that fires on both would be half noise and would get muted.
  */
  const missing = handlerCases.filter((c) => !endpoint.enabledEvents.includes(c));
  if (missing.length) {
    findings.push({
      rule: 'every handled event is one the endpoint will send',
      detail: `handled but not subscribed: ${missing.join(', ')}`,
      consequence:
        'That handler can never run in production. It passes every unit test, is exercised by ' +
        'every fixture, and is unreachable — which is indistinguishable from working right up ' +
        'until the day it was needed.',
    });
  }

  return findings;
}

/**
 * The portal must still do what `/terms` says it does.
 *
 * Reported as a finding rather than as an assertion about OUR configuration,
 * because it is not ours: it is account-level and shared.
 */
export function checkPortalContract(portal: LivePortal): Finding[] {
  const findings: Finding[] = [];

  if (!portal.isDefault) {
    findings.push({
      rule: 'the audited portal configuration is the default one',
      detail: `${portal.id} reports is_default=false`,
      consequence:
        'The configuration customers actually get was not read. A correct answer about the ' +
        'wrong object is worse than no answer, because it gets recorded as a fact.',
    });
  }

  if (!portal.active) {
    findings.push({
      rule: 'the default portal configuration is active',
      detail: `${portal.id} reports active=false`,
      consequence: 'Customers reaching the portal meet an error instead of a cancel control.',
    });
  }

  if (!portal.cancelEnabled) {
    findings.push({
      rule: 'the portal offers cancellation at all',
      detail: 'features.subscription_cancel.enabled is false',
      consequence:
        '`/terms` promises "cancel at any time" and there is no self-serve way to do it. Every ' +
        'cancellation becomes a support email answered by hand.',
    });
  } else if (portal.cancelMode !== TERMS_IMPLY_CANCEL_MODE) {
    findings.push({
      rule: `the portal cancels ${TERMS_IMPLY_CANCEL_MODE}, as /terms promises`,
      detail: `mode is ${JSON.stringify(portal.cancelMode)}`,
      consequence:
        'A customer who cancels on day 31 loses the eleven months they paid for, and the refund ' +
        'window in lib/offer.ts has already closed. `/terms` told them the opposite. This is ' +
        'account-level and shared with three other products, so it can change without anyone ' +
        'here touching anything — which is exactly why it is re-measured rather than assumed.',
    });
  }

  return findings;
}

/**
 * The half a pinned constant cannot cover: `/terms` could be REWRITTEN to promise
 * immediate cancellation, leaving `TERMS_IMPLY_CANCEL_MODE` describing a sentence
 * that no longer exists. The checker above would then keep comparing the live
 * portal against a promise nobody makes, and keep passing.
 *
 * So the promise itself is asserted — the clause, not the whole sentence, so
 * ordinary copy edits do not break it.
 */
export function refundPolicyStillPromisesPeriodEnd(refundPolicy: string): Finding[] {
  const promisesPeriodEnd = /cancel\s+at\s+any\s+time\s+to\s+stop\s+the\s+next\s+one/i.test(
    refundPolicy,
  );
  if (promisesPeriodEnd) return [];

  return [
    {
      rule: 'REFUND_POLICY still makes the promise this wall pins',
      detail:
        'the clause "cancel at any time to stop the next one" is gone from lib/offer.ts -> REFUND_POLICY',
      consequence:
        `TERMS_IMPLY_CANCEL_MODE is pinned to ${JSON.stringify(TERMS_IMPLY_CANCEL_MODE)} because ` +
        'of that clause. If the copy changed, this wall is now comparing the live portal against ' +
        'a promise the product no longer makes — re-decide the pin in the same commit as the ' +
        'copy, rather than leaving a checker measuring a deleted sentence.',
    },
  ];
}

/**
 * Extract the handler's event list from the route source.
 *
 * Read from SOURCE rather than from a hand-kept list, for the reason this whole
 * module exists: a second hand-kept list would be a third definition of the same
 * contract.
 */
export function handlerCasesFrom(routeSource: string): string[] {
  const CASE = /^\s*case\s+'([a-z_]+(?:\.[a-z_]+)+)':/gm;
  return [...routeSource.matchAll(CASE)].map((m) => m[1]);
}
