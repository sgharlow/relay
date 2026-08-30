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
  nth(i: number): LocatorLike;
  waitFor(o: { state: string; timeout?: number }): Promise<void>;
  getByLabel(r: RegExp): LocatorLike;
  getByRole(role: string, o: { name: RegExp }): LocatorLike;
  /** Narrow a set of matches by their text — used to ask what COLOUR a sentence is painted in. */
  filter(o: { hasText: RegExp }): LocatorLike;
  evaluate<T>(fn: (el: HTMLElement) => T): Promise<T>;
};
interface PageLike {
  goto(url: string, o?: { waitUntil?: string }): Promise<unknown>;
  locator(sel: string): LocatorLike;
  getByRole(role: string, o: { name: RegExp }): LocatorLike;
  /** By ACCESSIBLE NAME. A control found this way goes red when its label regresses. */
  getByLabel(r: RegExp): LocatorLike;
  screenshot(o: { path: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  /** Wait on a condition rather than a timer — a sleep long enough to be safe is a slow walk. */
  waitForFunction(
    fn: () => boolean,
    arg?: unknown,
    o?: { timeout?: number },
  ): Promise<unknown>;
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
        // Required at the write boundary since 035 Phase 1 was hardened. A real
        // write derives this in encryptForUpload; this walk uses a placeholder blob
        // it never decrypts, so it declares directly — which is exactly the contract
        // the boundary enforces for a hand-built payload.
        secret_kinds: 'password',
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

    // =====================================================================
    // PART 3 — the preparedness sentence, which only a browser can see
    // =====================================================================
    /*
      🔴 THE LAST UNASSERTED HOP. `/api/readiness` is now read by verify:factors,
      so the SQL projection, the row mapping and the rule are covered as far as
      the payload. The SENTENCE is assembled client-side by
      `preparednessSentence(p, whoLabel)` inside ReadinessBanner, so nothing over
      HTTP can see it — and that stretch has real failure modes with no red
      anywhere: the banner does `.catch(() => setData(null))` and then
      `if (!data) return null`, so a failed fetch renders NOTHING, silently. The
      prompt's own guard (`p.unaskedItems.length > 0`) is the same shape.

      Two people hand-ran a browser check for this behaviour on 2026-08-18 — one
      for D3, one for the cross-surface refresh — and neither left anything that
      runs again. This is that check, kept.

      ⚠️ IT ASSERTS THAT THE WORDS MOVE, NOT WHICH WORDS. Pinning the copy would
      couple the release chain to sentences that are allowed to change, and
      re-deriving the number here would be the walk recomputing the answer —
      the exact mistake verify:factors was just corrected for. What must be true
      is that an answer changes the claim on screen.
    */
    const kin = undeliverable(`relay-ui-kin-${stamp}@relay.test`);
    const kinRes = await owner.post('/api/recipients', {
      name: 'Sam Rivera', email: kin, relationship: 'child', phone: null, role: 'recipient',
    });
    const kinId = String((kinRes.body as { id: string }).id);

    for (const title of ['Primary email', 'Main bank']) {
      const made = await owner.post('/api/vault/items', {
        title, type: 'account', service_name: title, category: 'communication',
        ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==', wrapped_data_key: 'AAAAAAAAAAAA',
        kms_key_id: 'e2e-placeholder',
        // A password and nothing else — the shape the question is about.
        secret_kinds: 'password',
      });
      await owner.post('/api/rules', {
        recipient_id: kinId, vault_item_id: String((made.body as { id: string }).id),
        trigger_type: 'emergency', scope: 'view', reversible: true,
      });
    }

    /** The standing claim, read off the screen rather than recomputed. */
    const sentence = async (): Promise<string> =>
      (/If something happened tomorrow[^.]*\./.exec(await page.locator('body').innerText()) ?? [''])[0];

    /*
      Every one of these sentences opens with the same twelve words, so a detail
      string that truncates shows two identical halves and tells the next reader
      nothing about what moved. Report the part that differs.
    */
    const said = (s: string): string => (/could reach (.*)$/.exec(s) ?? [, s])[1] ?? s;

    /*
      ⚠️ A FIXED SLEEP MADE THIS CHECK FLAKY, AND A FLAKY ASSERTION IN THE
      RELEASE CHAIN IS WORSE THAN NO ASSERTION — it teaches whoever runs it to
      discount red. `/api/readiness` runs about ten queries against DSQL, so the
      refresh after an answer sometimes lands well after two and a half seconds:
      one run sampled the pre-answer render and reported a defect that was not
      there. Poll for the change instead, with a bound. What is being asserted
      is that the screen agrees EVENTUALLY, not that it agrees within an
      arbitrary sleep; a change that never arrives still fails, which is the
      thing worth failing on.
    */
    async function waitForChange(read: () => Promise<string>, from: string, ms = 20_000): Promise<string> {
      const deadline = Date.now() + ms;
      let now = from;
      while (Date.now() < deadline) {
        now = await read();
        if (now !== from) return now;
        await page.waitForTimeout(500);
      }
      return now;
    }

    /** The same, for a count that should settle on a value. */
    async function waitForCount(read: () => Promise<number>, want: number, ms = 20_000): Promise<number> {
      const deadline = Date.now() + ms;
      let n = await read();
      while (Date.now() < deadline && n !== want) {
        await page.waitForTimeout(500);
        n = await read();
      }
      return n;
    }

    const asks = () => page.getByRole('button', { name: /asks for a code as well as a password/i });

    await page.goto(`${BASE}/vault`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const first = await sentence();
    check('the preparedness sentence renders at all', first.length > 0, said(first));
    check(
      'and the owner is ASKED about the items nobody has answered for',
      (await asks().count()) === 2,
      `${await asks().count()} prompted`,
    );

    // ── Answering in the BANNER moves the sentence above it ───────────────
    await page.getByRole('button', { name: /A password is enough for Primary email/i }).click();
    const afterBanner = await waitForChange(sentence, first);
    check(
      'answering in the banner changes the claim the banner makes',
      afterBanner !== first && afterBanner.length > 0,
      `${said(first)} -> ${said(afterBanner)}`,
    );
    const promptedAfterBanner = await waitForCount(() => asks().count(), 1);
    check(
      'and the answered item stops being asked about',
      promptedAfterBanner === 1,
      `${promptedAfterBanner} still prompted`,
    );

    // ── Answering on the ROW moves it too, with no reload ─────────────────
    /*
      The other direction, and the worse one: the row and the banner are
      siblings in different trees, so before the announcement landed, answering
      here left the sentence — the surface this repo calls authoritative —
      stating a preparedness the owner had just superseded. No `goto` below on
      purpose; a reload would hide exactly the defect this asserts.
    */
    const rowControl = page.getByRole('button', { name: /^Needs a code\?$/ });
    check('the remaining item still offers the question on its row', (await rowControl.count()) === 1);

    await rowControl.first().click();
    const afterRow = await waitForChange(sentence, afterBanner);
    check(
      'answering on the row moves the sentence without a reload',
      afterRow !== afterBanner && afterRow.length > 0,
      `${said(afterBanner)} -> ${said(afterRow)}`,
    );
    const promptedAfterRow = await waitForCount(() => asks().count(), 0);
    check(
      'and nothing is left to ask about',
      promptedAfterRow === 0,
      `${promptedAfterRow} still prompted`,
    );

    // =====================================================================
    // PART 4 — /circle, and the form nothing automated had ever typed into
    // =====================================================================
    /*
      🔴 WHY THIS PART EXISTS, added 2026-08-21. J4-R1's single entry shipped
      that afternoon — `POST /api/people` plus one `AddPersonForm`, replacing the
      two add forms on /circle — and `docs/user-journeys.md` recorded the gap in
      its own header: the a11y run LOADED the new form as one of its pages, but
      **a11y cover is not functional cover**, and this walk visited /account,
      /access and /vault and never opened /circle. So nothing automated had ever
      typed a name into the one form every owner meets first.

      The discriminating assertion is the DISABLED SUBMIT. `noHat` disables the
      button until at least one checkbox is ticked, and says why. A person with
      no hat is a row that can do nothing; the server refuses it too. That guard
      is pure client state — invisible to every HTTP walk in the chain, and the
      exact class of thing PART 1 exists to catch on the other screen.
    */
    const circle = await (await contextFor(browser, owner.email)).newPage();
    await circle.goto(`${BASE}/circle`, { waitUntil: 'networkidle' });

    check('the circle page renders for a signed-in owner', await circle.locator('h1').isVisible());

    const submit = circle.getByRole('button', { name: /Add this person/i });
    check('the single add-a-person form is on the page', (await submit.count()) > 0);

    const recipientBox = circle.locator('input[type="checkbox"]').first();
    const verifierBox = circle.locator('input[type="checkbox"]').nth(1);

    const personName = `Walked Contact ${stamp}`;
    const personEmail = undeliverable(`relay-ui-circle-${stamp}@relay.test`);
    await circle.locator('input[placeholder="Name"]').first().fill(personName);
    await circle.locator('input[placeholder="Email"]').first().fill(personEmail);

    /*
      ⚠️ THE FORM SHIPS WITH "Step in" ALREADY TICKED (`EMPTY.recipient = true`),
      and the first draft of this walk asserted a disabled button on a fresh page
      and went red. That default is right — the common case is a recipient — so
      the guard is only reachable by UNTICKING, which is also the realer gesture:
      an owner adding somebody who will only confirm emergencies unticks the
      first box before ticking the second, and passes through the dead state on
      the way.
    */
    const enabledByDefault = await submit.first().evaluate((el) => (el as HTMLButtonElement).disabled);
    check(
      'the form opens ready to add a recipient — the common case needs no ticking',
      enabledByDefault === false,
      `disabled=${enabledByDefault}`,
    );

    await recipientBox.click();
    const disabledWithNoHat = await submit.first().evaluate((el) => (el as HTMLButtonElement).disabled);
    check(
      '🔴 untick every hat and Add DISABLES — not a dead button that fails on click',
      disabledWithNoHat === true,
      `disabled=${disabledWithNoHat} — pure client state, invisible to every HTTP walk`,
    );
    check(
      'and it says WHY, rather than leaving the owner to guess',
      /Tick at least one/i.test(await circle.locator('body').innerText()),
      'the refusal is stated before the click is wasted',
    );

    // Both hats on one person — the case the copy above the form exists to
    // explain, and the one the two old forms made impossible without entering
    // them twice.
    await recipientBox.click();
    await verifierBox.click();

    const enabledNow = await submit.first().evaluate((el) => (el as HTMLButtonElement).disabled);
    check('re-ticking a hat enables Add again', enabledNow === false, `disabled=${enabledNow}`);

    await submit.first().click();
    await circle.locator('[role="status"]').first().waitFor({ state: 'visible', timeout: 20_000 });
    const said4 = await circle.locator('[role="status"]').first().innerText();
    check(
      '🔴 THE POINT: a name typed into the real form creates the person',
      said4.length > 0 && new RegExp(personName.split(' ')[0], 'i').test(said4 + (await circle.locator('body').innerText())),
      said4.slice(0, 90),
    );

    /*
      And ONE person, not two rows. The whole reason the two forms were folded
      into one is that a husband who both steps in and confirms is one human;
      creating him twice is the defect the unified form was built to remove.
    */
    const bothHats = await query<{ n: string }>(
      `SELECT
         (SELECT count(*) FROM recipients r JOIN users u ON u.id = r.owner_id
           WHERE u.email = $1 AND r.email = $2) AS rec,
         (SELECT count(*) FROM verifiers v JOIN users u ON u.id = v.owner_id
           WHERE u.email = $1 AND v.email = $2) AS ver`,
      [owner.email, personEmail],
    );
    const row = bothHats.rows[0] as unknown as { rec: string; ver: string };
    check(
      'both hats landed — one person named once, in both roles',
      Number(row.rec) === 1 && Number(row.ver) === 1,
      `recipient rows=${row.rec} verifier rows=${row.ver}`,
    );

    // =====================================================================
    // PART 5 — /triggers, and whether an owner can SEE an unsatisfiable quorum
    // =====================================================================
    /*
      🔴 THE STATE THIS WALKS IS THE LIVE SYSTEM'S OWN. On 2026-08-30 the one
      real owner holds N = 1 against M = 0 eligible verifiers: a person was
      named, has not accepted, and `isEligibleVerifier` counts only `confirmed`.
      A trigger firing reaches GRACE and stops there for good. Nothing leaks —
      GRACE is where verifiers are asked, not where access opens — but the plan
      cannot complete, and no screen says so.

      The owner built in PART 4 is in exactly that state: one person wearing both
      hats, `invited`, never confirmed. So this asks the question the product's
      only user is currently living inside.

      ⚠️ WHAT THE SERVER ALREADY GUARANTEES, AND WHY THAT IS NOT ENOUGH.
      `assertQuorumSatisfiable` refuses N > M, and `PUT /api/triggers/[id]/config`
      is unit-tested to feed it the right rows — unconfirmed people excluded, a
      verifier who is also a recipient excluded, one human holding two rows
      counted once. So the REFUSAL is proven. What no HTTP test can see is
      whether the refusal ever reaches a person: the screen renders
      `received/required` and NEVER RENDERS M, so an owner learns how many people
      could actually answer only by asking for too many and reading what comes
      back. If that sentence is swallowed, or painted in the reassuring colour,
      an owner is left believing they set a quorum that cannot complete.

      That is the same defect class `StatusLine.test.tsx` pins — an error arriving
      in sage, the colour this product uses for "closed, safe" — and it is pure
      client state, invisible to every walk in both chains.
    */
    const triggers = await (await contextFor(browser, owner.email)).newPage();
    await triggers.goto(`${BASE}/triggers`, { waitUntil: 'networkidle' });

    check('the triggers page renders for a signed-in owner', await triggers.locator('h1').isVisible());

    /*
      Located by ACCESSIBLE NAME, not by position. axe flagged this control as
      `label` (critical) once already — the text beside the box named it for
      somebody looking at it and for nobody using a screen reader — and the fix
      was an explicit `aria-label` that also names the trigger, because the page
      renders one of these per trigger and two controls both called "people who
      must agree" are not distinguishable. Finding it this way means the walk
      goes red if that name regresses, which is the half axe cannot check on a
      screen it has no credentials to reach.
    */
    const quorumBox = triggers.getByLabel(/People who must agree first/i).first();
    const quorumCount = await triggers.getByLabel(/People who must agree first/i).count();
    check(
      'the quorum control carries an accessible name, not just adjacent text',
      quorumCount > 0,
      `controls found by accessible name: ${quorumCount}`,
    );

    if (quorumCount > 0) {
      const before = await triggers.locator('body').innerText();
      check(
        '🔴 the screen never tells the owner how many people COULD answer',
        !/could answer/i.test(before),
        'recorded, not asserted as desirable — it is why the refusal below is the ' +
          'only place M appears, and therefore why it has to be readable',
      );

      await quorumBox.fill('5');
      await triggers.getByRole('button', { name: /^Set$/ }).first().click();

      // The refusal is a round trip; wait for the sentence rather than a timer.
      await triggers
        .waitForFunction(() => /could answer|confirm/i.test(document.body.innerText), undefined, {
          timeout: 15_000,
        })
        .catch(() => {});

      const after = await triggers.locator('body').innerText();
      check(
        '🔴 asking for more confirmations than anyone can give is REFUSED, in words',
        /could answer/i.test(after),
        after.split('\n').find((l) => /could answer/i.test(l))?.trim() ?? 'no such sentence',
      );
      check(
        'the refusal names BOTH numbers, so the owner learns M from it',
        /5 people to confirm/i.test(after) && /only 0 could answer/i.test(after),
        'the screen shows received/required and never M — this sentence is the only place it appears',
      );

      /*
        THE COLOUR, which is the half a text assertion misses. StatusLine paints
        `ok: false` in clay and `ok: true` in sage; sage is this product's colour
        for "closed, safe". A refusal arriving in sage, beside a number the owner
        just set, reads as confirmation that it saved.
      */
      const sageOnRefusal = await triggers
        .locator('.text-sage-text')
        .filter({ hasText: /could answer/i })
        .count();
      check(
        '🔴 and it is NOT painted in the colour this product uses for "safe"',
        sageOnRefusal === 0,
        `elements matching .text-sage-text containing the refusal: ${sageOnRefusal}`,
      );

      // And it must not have saved. The refusal is a refusal, not a warning.
      const stored = await query<{ n: string }>(
        `SELECT coalesce(max(required_confirmations), 0)::text AS n
           FROM release_state rs JOIN users u ON u.id = rs.owner_id
          WHERE u.email = $1`,
        [owner.email],
      );
      const storedN = Number((stored.rows[0] as unknown as { n: string })?.n ?? 0);
      check(
        'nothing was written — an impossible quorum is refused, not stored',
        storedN !== 5,
        `required_confirmations in release_state = ${storedN}`,
      );
    }

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
