/**
 * scripts/verify-funnel.ts — is the G1 instrument alive, right now, on production?
 *
 *   npm run verify:funnel                       # production
 *   FUNNEL_BASE_URL=http://localhost:3000 npm run verify:funnel
 *
 * WHY THIS EXISTS. `g1-ad-creatives.md` says it plainly: "The funnel has been
 * silently dead before — `window.va` was undefined at the moment both trackers
 * fired, and optional chaining swallowed every event. It was invisible for weeks
 * and was only found by driving a real browser. **Do not trust a green suite
 * here.**" It has now happened twice. The Lane-B numerator emitted nothing at
 * all between 2026-08-08 and 2026-08-10.
 *
 * A ratified $250 is about to run against this instrument over a four-week
 * window. A dead funnel does not fail loudly: the ads serve, the clicks land,
 * the page renders, and the gate reads zero — which is indistinguishable from a
 * product nobody wants, and the kill threshold is `< 0.5%`. The most expensive
 * failure available here is not a rejected creative; it is a month of spend
 * measured by an instrument that stopped reporting.
 *
 * So the manual pre-flight walk becomes a command. It was a one-sitting check
 * performed before launch; the risk it covers lasts the whole flight, and the
 * daily rhythm in the runbook has nowhere to put "and confirm the instrument is
 * still alive" unless that is one thing to run.
 *
 * 🔴 IT MUST NOT CONTAMINATE THE THING IT PROTECTS. Driving this funnel with a
 * real lane `src` injects one qualified and one intent at 100% conversion — a
 * full percentage point on a 2% ship line at N=100, biasing toward a false PASS.
 * A `caregiver_leads` row can be deleted; a Vercel Analytics event CANNOT. So
 * the guard is structural rather than a warning in a header: the script asks
 * `isGateQualifyingSrc` — the same function the gate itself uses — and refuses
 * to start if the src would count. One authoritative definition, not two.
 *
 * It also never submits the interest form, so it writes nothing to the database
 * and leaves no row for anybody to remember to delete.
 *
 * NOT IN CI: it drives a real browser against a real deployment. It is the
 * daily check during a flight, and the last thing to run before a creative is
 * submitted.
 *
 * 🔴 WHY IT READS `window.vaq` AND NOT ONLY THE NETWORK POST — this cost an
 * hour and would otherwise have shipped a check that cries wolf every run.
 *
 * The first version asserted on the `…/event` POST, having watched exactly that
 * request carry `{"src":"qa"}` minutes earlier in a real browser. Under
 * Playwright it reported all five instrument checks FAILED — "the denominator
 * is dead" — against a funnel that was demonstrably alive. Vercel Analytics
 * suppresses automation: `navigator.webdriver` is true, so the loader never
 * flushes and NOTHING goes over the wire. Neither a headed browser nor a
 * realistic user agent changes it.
 *
 * `window.vaq` is the SDK's pre-flush queue, and it is the better assertion
 * anyway. It observes OUR code — did the tracker fire, with the right `src` and
 * `cta`? — which is precisely what has broken twice. The network POST observes
 * Vercel's delivery, which is their infrastructure and is suppressed for us by
 * design. So both sources are read and merged: whichever this environment
 * yields, the assertions are the same.
 *
 * ⚠️ STATED PLAINLY BECAUSE IT BOUNDS THE CLAIM: a queued event proves the
 * tracker fired correctly. It does NOT prove Vercel ingested it. Delivery is
 * proven by a human driving a real browser and reading the wire — part 1 step 2
 * of the runbook — which is a different check, and this does not replace it.
 *
 * Feature: relay-h0-mvp (G1)
 */

import { isGateQualifyingSrc } from '../src/app/caregivers/content';

const HOME = process.env.USERPROFILE?.replace(/\\/g, '/') ?? process.env.HOME;

// Same resolution as scripts/e2e-ui.ts: playwright lives in the shared toolbox.
const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ||
  `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;

const BASE = (process.env.FUNNEL_BASE_URL ?? 'https://relaystandby.com').replace(/\/$/, '');
const SRC = process.env.FUNNEL_SRC ?? 'qa';

/** The slice of Playwright used here, declared so `tsc --noEmit` stays meaningful. */
interface RequestLike {
  url(): string;
  postData(): string | null;
}
interface PageLike {
  on(event: 'request', fn: (r: RequestLike) => void): void;
  goto(url: string, o?: { waitUntil?: string }): Promise<unknown>;
  getByRole(role: string, o: { name: RegExp }): { first(): { click(): Promise<void> } };
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
  evaluate<T>(fn: () => T): Promise<T>;
}
interface BrowserLike {
  newContext(): Promise<{ newPage(): Promise<PageLike> }>;
  close(): Promise<void>;
}

interface AnalyticsEvent {
  en: string;
  ed?: Record<string, unknown>;
}

import { verdict, collectionFromEnv } from '../lib/ops/funnel-instrument';

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function record(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  /*
    The structural guard, first, before a browser even opens. Everything after
    this line emits permanent analytics events.
  */
  if (isGateQualifyingSrc(SRC)) {
    console.error(
      `[funnel] REFUSING to run with src="${SRC}".\n` +
        `         That src COUNTS toward the G1 gate, so this walk would inject one\n` +
        `         qualified and one intent at 100% conversion — roughly a full point on a\n` +
        `         2% line at N=100, biasing toward a false PASS. A lead row can be deleted;\n` +
        `         a Vercel Analytics event cannot. Use "qa" or "preflight".`,
    );
    process.exit(1);
  }

  console.log(`[funnel] ${BASE}/caregivers?src=${SRC}`);
  console.log(`[funnel] src "${SRC}" is gate-excluded — safe to drive.\n`);

  const { chromium } = (await import(PLAYWRIGHT)) as { chromium: { launch(): Promise<BrowserLike> } };
  const browser = await chromium.launch();

  try {
    /*
      A FRESH CONTEXT IS NOT OPTIONAL. The channel is parked in sessionStorage
      and survives the visit, so a profile that has ever carried another `src`
      re-attributes this walk to it — which is exactly how a stray
      `src=visual-check` intent reached production analytics on 2026-08-10.
    */
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const sent: AnalyticsEvent[] = [];
    page.on('request', (r) => {
      if (!/\/event$/.test(r.url())) return;
      const body = r.postData();
      if (!body) return;
      try {
        sent.push(JSON.parse(body) as AnalyticsEvent);
      } catch {
        /* a body we cannot parse is reported by its absence below */
      }
    });

    /**
     * Everything the page has tracked: what went over the wire, plus what is
     * still queued because Vercel Analytics will not flush for automation.
     * Same assertions either way — see the header.
     */
    async function tracked(): Promise<AnalyticsEvent[]> {
      const queued = await page.evaluate<Array<[string, { name?: string; data?: Record<string, unknown> }]>>(
        () => (window as unknown as { vaq?: Array<[string, { name?: string; data?: Record<string, unknown> }]> }).vaq ?? [],
      );
      const fromQueue = queued
        .filter(([kind, p]) => kind === 'event' && p?.name)
        .map(([, p]) => ({ en: p.name as string, ed: p.data }));
      return [...sent, ...fromQueue];
    }

    // --- Step 1: the landing page renders -----------------------------------
    await page.goto(`${BASE}/caregivers?src=${SRC}`, { waitUntil: 'load' });
    await page.waitForTimeout(2500); // the tracker fires after hydration
    record('landing page loads', page.url().includes('/caregivers'), page.url());

    // --- Step 2: caregiver_qualified, read off the wire ----------------------
    const qualified = (await tracked()).find((e) => e.en === 'caregiver_qualified');
    record(
      'caregiver_qualified fires',
      !!qualified,
      qualified ? JSON.stringify(qualified.ed) : 'NO EVENT — the denominator is dead',
    );
    record(
      `caregiver_qualified carries src="${SRC}"`,
      qualified?.ed?.src === SRC,
      String(qualified?.ed?.src ?? '(none)'),
    );

    // --- Step 3: the priced CTA emits caregiver_intent -----------------------
    await page.getByRole('link', { name: /Start your family's vault/i }).first().click();
    await page.waitForTimeout(2500);
    record('priced CTA reaches the interest page', page.url().includes('/caregivers/interest'), page.url());

    const afterClick = await tracked();
    const intent = afterClick.find((e) => e.en === 'caregiver_intent');
    record(
      'caregiver_intent fires',
      !!intent,
      intent ? JSON.stringify(intent.ed) : 'NO EVENT — the numerator is dead',
    );
    record(
      `caregiver_intent carries src="${SRC}" and cta="hero"`,
      intent?.ed?.src === SRC && intent?.ed?.cta === 'hero',
      `src=${String(intent?.ed?.src ?? '(none)')} cta=${String(intent?.ed?.cta ?? '(none)')}`,
    );

    /*
      The ratio is numerator/denominator. If the two events disagree about which
      channel they belong to, there is no ratio to compute — and the failure is
      invisible in each event taken on its own, which is why it is asserted
      rather than assumed from the two checks above.
    */
    record(
      'both events agree on src (the ratio is computable)',
      !!qualified && !!intent && qualified.ed?.src === intent.ed?.src,
      `${String(qualified?.ed?.src ?? '(none)')} / ${String(intent?.ed?.src ?? '(none)')}`,
    );

    // The interest form is deliberately NOT submitted: this check writes nothing.
  } finally {
    await browser.close();
  }

  /*
    🔴 THE VERDICT IS TWO CLAIMS AND THIS WALK CAN ONLY PROVE ONE.
    Everything above is the EMIT half: the page fires both events, they carry
    `src`, and the ratio is computable. Whether anything COLLECTS them is a fact
    about the Vercel project, not about the page, and on 2026-08-31 this walk
    passed 7/7 while the Web Analytics API answered `web_analytics_not_enabled`.

    So the verdict moves to `lib/ops/funnel-instrument.ts`, which refuses to say
    "alive" from emit evidence alone. See that file for why this is the most
    expensive place in the repository for a false green.
  */
  const passed = results.filter((r) => r.ok).length;
  const v = verdict({
    emitPassed: passed,
    emitTotal: results.length,
    collection: collectionFromEnv(process.env.FUNNEL_COLLECTION),
  });

  console.log('');
  const out = v.code === 0 ? console.log : console.error;
  out(`[funnel] ${v.line}`);
  for (const line of v.notes) out(line ? `[funnel] ${line}` : '');
  process.exit(v.code);
}

main().catch((err) => {
  console.error('[funnel] Unexpected error:', err);
  process.exit(1);
});
