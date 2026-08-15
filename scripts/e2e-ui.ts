/**
 * The two NEW screens, driven in a real browser by a real signed-in person.
 *
 * WHY THIS EXISTS AND `e2e-stepup.ts` IS NOT ENOUGH. That harness proves the
 * SERVER: 403 StepUpRequired, elevation, revocation, the spend on closure. It
 * says nothing about the two things a person actually meets — the
 * "Confirm it's you" dialog and the owner picker — because it never renders
 * them. A guard that refuses correctly and a prompt nobody can answer look
 * identical over HTTP, which is the exact failure mode step-up's own deferral
 * note warned about, and an HTTP harness reproduces it rather than catching it.
 *
 * So this clicks the buttons: the dialog must appear because of what was
 * pressed, accept a code, and the ORIGINAL action must then complete — the
 * interruption costing one step rather than two.
 *
 * ⚠️ Writes to whatever `E2E_BASE` points at, and `.env.local` points at the
 * production cluster. Disposable accounts on RFC 6761 reserved domains, all
 * deleted at the end.
 *
 *   npx tsx --env-file=.env.local scripts/e2e-ui.ts
 */
import { encode } from 'next-auth/jwt';

import { generateTotpCodeFor } from '../lib/auth/totp';
import { query, closeAllPools } from '../lib/db/connection';
import { readSessionEpoch } from '../lib/auth/session-epoch';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';

const HOME = (process.env.HOME || process.env.USERPROFILE || '').split('\\').join('/');
const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ||
  `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;

const RESERVED = ['test', 'invalid', 'localhost'];
function undeliverable(a: string): string {
  if (!RESERVED.includes(a.split('.').pop() as string)) {
    throw new Error(`refusing to use ${a}: not a reserved, undeliverable domain`);
  }
  return a;
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail = ''): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(58)} ${detail}`);
}

// ---------------------------------------------------------------------------
// A tiny HTTP actor, only to BUILD the fixtures. Every assertion is in the DOM.
// ---------------------------------------------------------------------------
class Http {
  readonly jar = new Map<string, string>();
  constructor(readonly email: string, public secret = '') {}

  private remember(res: Response): void {
    for (const [k, v] of res.headers) {
      if (k.toLowerCase() !== 'set-cookie') continue;
      for (const part of v.split(/,(?=[^;]+?=)/)) {
        const [pair] = part.trim().split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    }
  }

  async call(path: string, init: RequestInit = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(init.headers ?? {}) },
    });
    this.remember(res);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    return { status: res.status, body };
  }

  post(path: string, b: unknown) {
    return this.call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  }

  async signUp(displayName: string): Promise<void> {
    const begin = await this.post('/api/auth/signup', { email: this.email, displayName });
    if (begin.status !== 201) throw new Error(`signup begin ${begin.status}`);
    const secret = new URL(String(begin.body.otpauthUrl).replace('otpauth://', 'https://'))
      .searchParams.get('secret');
    if (!secret) throw new Error('no secret');
    this.secret = secret;
    const done = await this.call('/api/auth/signup', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrolmentToken: begin.body.enrolmentToken, code: generateTotpCodeFor(secret) }),
    });
    if (done.status !== 200) throw new Error(`signup complete ${done.status}`);
  }

  async signIn(): Promise<void> {
    const csrf = await this.call('/api/auth/csrf');
    await this.call('/api/auth/callback/email-totp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrfToken: String(csrf.body.csrfToken),
        email: this.email,
        totpCode: generateTotpCodeFor(this.secret),
        json: 'true',
        callbackUrl: BASE,
      }).toString(),
    });
  }
}

/** A session cookie for any existing user — the same trick a11y-audit uses. */
async function sessionCookie(email: string): Promise<string> {
  const r = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (!r.rows.length) throw new Error(`no such user: ${email}`);
  const u = r.rows[0];
  return (await encode({
    token: {
      sub: u.id,
      email: u.email,
      ownerId: u.id,
      isDemo: false,
      sessionEpoch: (await readSessionEpoch(u.id)) ?? 0,
    },
    secret: process.env.NEXTAUTH_SECRET as string,
  })) as string;
}

/**
 * The slice of Playwright this script uses.
 *
 * Declared rather than imported: `playwright` lives in the shared toolbox and is
 * resolved by URL at runtime (see PLAYWRIGHT above), so there are no types to
 * import. A local shape keeps `tsc --noEmit` meaningful over this file instead
 * of surrendering it to `any` — which is what `strict` is for, and this file is
 * type-checked like the rest of the repo now that it is tracked.
 */
interface BrowserLike {
  newContext(opts: {
    viewport: { width: number; height: number };
  }): Promise<{
    addCookies(c: Array<Record<string, unknown>>): Promise<void>;
    newPage(): Promise<PageLike>;
  }>;
  close(): Promise<void>;
}
type LocatorLike = {
  isVisible(): Promise<boolean>;
  count(): Promise<number>;
  innerText(): Promise<string>;
  allInnerTexts(): Promise<string[]>;
  click(): Promise<void>;
  fill(v: string): Promise<void>;
  first(): LocatorLike;
  waitFor(o: { state: string; timeout?: number }): Promise<void>;
  getByLabel(r: RegExp): LocatorLike;
  getByRole(role: string, o: { name: RegExp }): LocatorLike;
  evaluate<T>(fn: (el: HTMLElement) => T): Promise<T>;
};
interface PageLike {
  goto(url: string, o?: { waitUntil?: string }): Promise<unknown>;
  locator(sel: string): LocatorLike;
  getByRole(role: string, o: { name: RegExp }): LocatorLike;
  screenshot(o: { path: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
}

async function contextFor(
  browser: BrowserLike,
  email: string,
  viewport = { width: 1280, height: 1000 },
) {
  const value = await sessionCookie(email);
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    { name: 'next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  return ctx;
}

async function main(): Promise<void> {
  const { chromium } = (await import(PLAYWRIGHT)) as { chromium: { launch(): Promise<BrowserLike> } };
  const browser = await chromium.launch();
  const stamp = Date.now();

  const owner = new Http(undeliverable(`relay-ui-owner-${stamp}@relay.test`));
  const a = new Http(undeliverable(`relay-ui-a-${stamp}@relay.test`));
  const b = new Http(undeliverable(`relay-ui-b-${stamp}@relay.test`));
  const contactEmail = undeliverable(`relay-ui-contact-${stamp}@relay.test`);

  try {
    // =====================================================================
    // PART 1 — the "Confirm it's you" dialog on /account
    // =====================================================================
    await owner.signUp('UI Owner');
    await owner.signIn();

    const page = await (await contextFor(browser, owner.email)).newPage();
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });

    check('the account page renders for a signed-in owner', await page.locator('h1').isVisible());

    // The dialog must NOT be there before anything is pressed. Prompting on
    // arrival is what teaches people to dismiss it.
    check(
      'no prompt on arrival — it appears in response to intent',
      (await page.locator('[role="dialog"]').count()) === 0,
    );

    await page.getByRole('button', { name: /Issue new recovery codes/i }).click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    check('pressing the guarded action opens the prompt', await dialog.isVisible());

    check(
      'it explains itself in terms of what was pressed',
      /Issuing a new recovery sheet/i.test(await dialog.innerText()),
    );
    check(
      'it offers the factor this account actually holds',
      (await dialog.getByLabel(/Authenticator code/i).count()) === 1 &&
        (await dialog.getByRole('button', { name: /passkey/i }).count()) === 0,
    );
    check('focus lands in the field', await dialog.getByLabel(/Authenticator code/i).evaluate(
      (el: HTMLElement) => el === document.activeElement,
    ));

    /*
      🔴 THIS SHIPPED WITH NO BACKDROP AND NOTHING NOTICED. It asked for
      `bg-ink/40`; every colour token is a CSS variable holding a hex, and
      Tailwind cannot apply an opacity modifier to one, so it computed to
      `rgba(0, 0, 0, 0)` — a "modal" floating over undimmed content that competed
      with it. The class was valid, the build passed, and the only symptom was
      visible. Read the computed value, which is the only thing that can tell a
      transparent backdrop from an absent one.
    */
    const scrim = await dialog.evaluate((el: HTMLElement) => {
      const bg = getComputedStyle(el).backgroundColor;
      const a = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(bg);
      return { bg, alpha: a ? Number(a[1]) : 1 };
    });
    check(
      'the page behind is actually dimmed',
      scrim.alpha > 0.1 && scrim.alpha < 1,
      scrim.bg,
    );

    // A wrong code must say so and keep the dialog open.
    await dialog.getByLabel(/Authenticator code/i).fill('000000');
    await dialog.getByRole('button', { name: /^Confirm$/ }).click();
    await page.waitForTimeout(1500);
    check(
      'a wrong code is refused without closing the prompt',
      (await dialog.count()) === 1 && /did not match/i.test(await dialog.innerText()),
    );

    // Captured HERE, while it is open and showing its refusal — a screenshot
    // taken after success records the outcome and not the screen under test.
    await page.screenshot({ path: 'e2e-stepup-dialog.png' });

    // The real one. The ORIGINAL action must then complete by itself.
    await dialog.getByLabel(/Authenticator code/i).fill(generateTotpCodeFor(owner.secret));
    await dialog.getByRole('button', { name: /^Confirm$/ }).click();

    await page.locator('text=/They are not shown again/i').waitFor({ state: 'visible', timeout: 20_000 });
    check('the prompt closes on success', (await page.locator('[role="dialog"]').count()) === 0);
    check(
      'and the action the person asked for completes, without a second press',
      (await page.locator('ul.font-mono li').count()) > 0,
      `${await page.locator('ul.font-mono li').count()} codes rendered`,
    );

    // =====================================================================
    // PART 2 — the owner picker on /access
    // =====================================================================
    for (const [o, label] of [
      [a, 'Ada Okonkwo'],
      [b, 'Ben Sørensen'],
    ] as Array<[Http, string]>) {
      await o.signUp(label);
      await o.signIn();
      const item = await o.post('/api/vault/items', {
        title: `${label} primary email`,
        type: 'account',
        service_name: 'Fastmail',
        category: 'communication',
        ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==',
        wrapped_data_key: 'AAAAAAAAAAAA',
        kms_key_id: 'e2e-placeholder',
      });
      const rec = await o.post('/api/recipients', {
        name: 'Shared contact',
        email: contactEmail,
        relationship: 'child',
        phone: null,
        role: 'executor',
      });
      const recipientId = String((rec.body as { id: string }).id);
      await o.post('/api/rules', {
        recipient_id: recipientId,
        vault_item_id: String((item.body as { id: string }).id),
        trigger_type: 'emergency',
        scope: 'view',
        reversible: true,
      });
      const inv = await o.post('/api/invitations', { personId: recipientId, personType: 'recipient' });

      // The contact claims, linking the second to the same account.
      const c = new Http(contactEmail);
      const csrf = await c.call('/api/auth/csrf');
      const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
        contactEmail,
      ]);
      await c.call('/api/auth/callback/standby-claim', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          csrfToken: String(csrf.body.csrfToken),
          token: String(inv.body.claimCode),
          ...(existing.rows[0] ? { existingUserId: existing.rows[0].id } : {}),
          json: 'true',
          callbackUrl: BASE,
        }).toString(),
      });

      await o.post('/api/triggers/emergency/initiate', {});
    }

    // A PHONE, because this screen is specified as happening on one at 2am.
    const cPage = await (await contextFor(browser, contactEmail, { width: 390, height: 844 })).newPage();
    await cPage.goto(`${BASE}/access`, { waitUntil: 'networkidle' });

    await cPage.locator('h1').waitFor({ state: 'visible', timeout: 20_000 });
    const heading = await cPage.locator('h1').innerText();
    check('the contact meets the picker, not one arbitrary plan', /Two people need you/i.test(heading), heading);

    const buttons = cPage.locator('ul li button');
    check('both people are offered', (await buttons.count()) === 2, `${await buttons.count()} options`);

    const optionText = await buttons.allInnerTexts();
    check(
      'each is named, and their state is in words a family uses',
      optionText.every((t: string) => /Ada Okonkwo|Ben Sørensen/.test(t)) &&
        optionText.every((t: string) => /Open now|Being confirmed/i.test(t)),
      optionText.map((t: string) => t.split('\n')[0]).join(' | '),
    );

    check(
      'no horizontal overflow at 390px',
      await cPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    );

    /*
      🔴 EVERY ASSERTION ABOVE PASSED WHILE THIS SCREEN WAS VISIBLY BROKEN, which
      is the whole argument for looking at the render rather than only querying
      it. globals.css gives every button `display: inline-flex; align-items:
      center` under `(pointer: coarse)` — the touch-target rule — so the option's
      two stacked spans became two flex items IN A ROW: the name in a narrow
      left column, wrapped mid-word, with the sentence beside it. The text was
      all present and correctly worded, so nothing textual could see it.

      Geometry is the only thing that can: the description must start BELOW the
      name, not beside it.
    */
    const stacked = await buttons.first().evaluate((el: HTMLElement) => {
      const [name, note] = el.querySelectorAll('span');
      const a = name.getBoundingClientRect();
      const b = note.getBoundingClientRect();
      return { below: b.top >= a.bottom - 1, nameLeft: a.left, noteLeft: b.left };
    });
    check(
      'the option stacks its name and description, rather than sitting them side by side',
      stacked.below && Math.abs(stacked.nameLeft - stacked.noteLeft) < 2,
      stacked.below ? 'stacked' : 'SIDE BY SIDE — the touch-target flex rule won',
    );

    await cPage.screenshot({ path: 'e2e-owner-picker.png' });

    /*
      Choosing one must leave the picker for THAT person's screen.

      NOT asserted through `h1`: both owners are still PENDING here (nobody has
      confirmed the emergency), so the chosen screen is the WAITING state, which
      renders as a notice with no heading. The first version of this check
      looked for an h1 and timed out — the test was wrong, not the app. Read the
      body instead, which is what the person reads.
    */
    const chosen = optionText[0].split('\n')[0];
    await buttons.first().click();
    await cPage.waitForTimeout(3000);

    const body = await cPage.locator('body').innerText();
    check('choosing one leaves the picker', !/Two people need you/i.test(body), `chose ${chosen}`);
    check(
      'the waiting state says nothing is wrong and nothing is needed',
      /not need to do anything/i.test(body),
      body.split('\n').find((l) => l.trim().length > 20)?.slice(0, 60) ?? '',
    );
    check(
      'and the way back to the other person is offered',
      (await cPage.getByRole('button', { name: /Someone else you stand by for/i }).count()) === 1,
    );

    await cPage.screenshot({ path: 'e2e-after-choice.png' });

    // And it really does go back.
    await cPage.getByRole('button', { name: /Someone else you stand by for/i }).click();
    await cPage.waitForTimeout(2500);
    check(
      'going back re-offers both people',
      /Two people need you/i.test(await cPage.locator('body').innerText()),
    );
  } finally {
    await browser.close().catch(() => {});
    console.log('');
    for (const o of [owner, a, b]) {
      if (!o.secret) continue;
      await o.signIn();
      await o.post('/api/account/step-up', { totpCode: generateTotpCodeFor(o.secret) });
      const res = await o.call('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: o.email }),
      });
      console.log(`  cleanup: ${o.email} -> HTTP ${res.status}`);
    }
    const c = new Http(contactEmail);
    const value = await sessionCookie(contactEmail).catch(() => null);
    if (value) {
      c.jar.set('next-auth.session-token', value);
      const res = await c.call('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: contactEmail }),
      });
      console.log(`  cleanup: ${contactEmail} (contact) -> HTTP ${res.status}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
