/**
 * Reshoot the guide's screenshots against the product as it is TODAY.
 *
 * WHY THIS IS A SCRIPT AND NOT A CHECKLIST. `public/guide/screens/*.png` is a
 * shared asset pool: the user's guide (`public/guide/index.html` → the PDF the
 * wedge audience puts in a drawer) and the use-case document
 * (`docs/use-cases.html` → `docs/Relay-Use-Cases.pdf`) both embed these files.
 * They have been reshot by hand at least three times (2026-08-12 ×2, -08-13),
 * and every hand reshoot froze the product of that evening: secret-types
 * Phase 0 then changed the reveal, `/vault/new`, `/import` and the vault list,
 * and every embedded image of those screens went quietly stale. A screenshot
 * that nothing can regenerate is a hand-copied volatile number in picture form.
 *
 * WHAT IT DOES. Stages the Chen-family fixture circle through the product's
 * OWN APIs — signup, items, people, invitations, claims, delegation, consent,
 * an emergency, a verifier confirmation, a release — asserting each step like
 * `e2e-reveal.ts` does, then walks a real browser through the staged states
 * and overwrites the stale screens. It is a functional walk that happens to
 * leave photographs.
 *
 * ⚠️ WRITES TO WHATEVER THE ENV POINTS AT, and `.env.local` points at the
 * PRODUCTION cluster (Relay has no dev database). All fixtures live on
 * RFC 6761 `.test` addresses, which `assertDeliverableDomain` refuses at the
 * email seam — nothing here can send mail. Cleanup is unconditional, through
 * the product's own deletion path, and prints the HTTP status of every delete.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/capture-screens.ts
 *
 * Then re-print BOTH derived documents (they embed these files):
 *   node scripts/guide-pdf.mjs           (needs `next dev`; see its header)
 *   node scripts/use-cases-pdf.mjs
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  encodeSecretPayload,
  type SecretField,
} from '../lib/crypto/secret-payload';
import { generateTotpCodeFor } from '../lib/auth/totp';
import { issueVerifierToken } from '../lib/auth/verifier-token';
import { CryptoService } from '../lib/crypto/crypto-service';
import { query, closeAllPools } from '../lib/db/connection';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const SCREENS = 'public/guide/screens';

/* Same resolution as guide-pdf.mjs / a11y-audit.mjs, for the same reason. */
const HOME = (process.env.HOME || process.env.USERPROFILE || '').split('\\').join('/');
const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE ||
  `file:///${HOME}/CascadeProjects/__shared-tools/node_modules/playwright/index.mjs`;

const RESERVED = ['test', 'invalid', 'localhost'];
function undeliverable(address: string): string {
  if (!RESERVED.includes(address.split('.').pop() as string)) {
    throw new Error(`refusing to use ${address}: not a reserved, undeliverable domain`);
  }
  return address;
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail = ''): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(62)} ${detail}`);
}

class Actor {
  readonly jar = new Map<string, string>();
  constructor(
    readonly label: string,
    readonly email: string,
    public secret = '',
  ) {}

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
      headers: {
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.headers ?? {}),
      },
    });
    this.remember(res);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { _raw: text.slice(0, 200) };
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

  patch(path: string, b: unknown) {
    return this.call(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  }

  /** The real session token this actor's sign-in produced, for the browser. */
  sessionToken(): string {
    const v = this.jar.get('next-auth.session-token');
    if (!v) throw new Error(`${this.label} holds no session cookie`);
    return v;
  }

  fetchAs(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      return fetch(path.startsWith('http') ? path : BASE + path, {
        ...init,
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(init?.headers ?? {}),
        },
      });
    }) as typeof fetch;
  }
}

async function signUp(a: Actor, displayName: string): Promise<void> {
  const begin = await a.post('/api/auth/signup', { email: a.email, displayName });
  if (begin.status !== 201) throw new Error(`${a.label} signup begin ${begin.status}`);
  const secret = new URL(
    String(begin.body.otpauthUrl).replace('otpauth://', 'https://'),
  ).searchParams.get('secret');
  if (!secret) throw new Error('no TOTP secret in the otpauth URL');
  a.secret = secret;
  const done = await a.call('/api/auth/signup', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enrolmentToken: begin.body.enrolmentToken,
      code: generateTotpCodeFor(secret),
    }),
  });
  if (done.status !== 200) throw new Error(`${a.label} signup complete ${done.status}`);
}

async function signIn(a: Actor): Promise<void> {
  const csrf = await a.call('/api/auth/csrf');
  await a.call('/api/auth/callback/email-totp', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken: String(csrf.body.csrfToken),
      email: a.email,
      totpCode: generateTotpCodeFor(a.secret),
      json: 'true',
      callbackUrl: BASE,
    }).toString(),
  });
}

async function claim(a: Actor, code: string) {
  const csrf = await a.call('/api/auth/csrf');
  return a.call('/api/auth/callback/standby-claim', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken: String(csrf.body.csrfToken),
      token: code,
      json: 'true',
      callbackUrl: BASE,
    }).toString(),
  });
}

interface ItemMeta {
  title: string;
  type: string;
  service_name: string;
  category: string;
}

async function saveEncrypted(owner: Actor, plaintext: string, meta: ItemMeta): Promise<string> {
  const svc = new CryptoService(owner.fetchAs());
  const payload = await svc.encryptForUpload(plaintext, meta as never);
  const res = await owner.post('/api/vault/items', payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`save ${meta.title}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return String(
    (res.body as { id?: string }).id ?? (res.body as { item?: { id: string } }).item?.id,
  );
}

async function closeOwner(o: Actor): Promise<void> {
  if (!o.secret) {
    console.log(`  cleanup: ${o.email} -> never created`);
    return;
  }
  await signIn(o);
  await o.post('/api/account/step-up', { totpCode: generateTotpCodeFor(o.secret) });
  const res = await o.call('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: o.email }),
  });
  console.log(`  cleanup: ${o.email} -> HTTP ${res.status}`);
}

async function closeContact(c: Actor): Promise<void> {
  const res = await c.call('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: c.email }),
  });
  console.log(`  cleanup: ${c.email} (contact) -> HTTP ${res.status}`);
}

/* Minimal structural types over Playwright, as e2e-ui.ts keeps them. */
interface PageLike {
  goto(url: string, o?: { waitUntil?: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  locator(sel: string): {
    first(): { click(): Promise<void>; waitFor(o: { state: string; timeout?: number }): Promise<void> };
    count(): Promise<number>;
  };
  getByRole(
    role: string,
    o: { name: RegExp },
  ): {
    first(): { click(): Promise<void>; waitFor(o: { state: string; timeout?: number }): Promise<void> };
    count(): Promise<number>;
    click(): Promise<void>;
  };
  getByText(re: RegExp): { first(): { waitFor(o: { state: string; timeout?: number }): Promise<void> }; count(): Promise<number> };
  setInputFiles?(sel: string, file: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
}
interface CtxLike {
  addCookies(c: Array<Record<string, unknown>>): Promise<void>;
  newPage(): Promise<PageLike>;
}
interface BrowserLike {
  newContext(o: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<CtxLike>;
  close(): Promise<void>;
}

const DESKTOP = { width: 1280, height: 1000 };
/** Matches every existing *-phone.png in the pool (430×932 viewport shots). */
const PHONE = { width: 430, height: 932 };

async function pageFor(
  browser: BrowserLike,
  viewport: { width: number; height: number },
  actor?: Actor,
): Promise<PageLike> {
  const ctx = await browser.newContext({ viewport });
  if (actor) {
    await ctx.addCookies([
      {
        name: 'next-auth.session-token',
        value: actor.sessionToken(),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  return ctx.newPage();
}

async function shoot(page: PageLike, path: string, o: { url?: string; fullPage?: boolean; settleMs?: number } = {}): Promise<void> {
  if (o.url) await page.goto(BASE + o.url, { waitUntil: 'networkidle' });
  // networkidle says the requests finished, not that fonts/images painted —
  // the same beat guide-pdf.mjs waits out before printing.
  await page.waitForTimeout(o.settleMs ?? 700);
  await page.screenshot({ path: join(SCREENS, path), fullPage: o.fullPage ?? true });
  console.log(`  📷 ${path}`);
}

async function main(): Promise<void> {
  const { chromium } = (await import(PLAYWRIGHT)) as {
    chromium: { launch(): Promise<BrowserLike> };
  };
  const stamp = Date.now();

  const owner = new Actor('Margaret Chen', undeliverable(`relay-shoot-owner-${stamp}@relay.test`));
  const sarah = new Actor('Sarah Chen', undeliverable(`relay-shoot-sarah-${stamp}@relay.test`));
  const patel = new Actor('Dr Patel', undeliverable(`relay-shoot-patel-${stamp}@relay.test`));

  const browser = await chromium.launch();
  const tmp = mkdtempSync(join(tmpdir(), 'relay-shoot-'));

  console.log(`base=${BASE}\n  owner=${owner.email}\n  sarah=${sarah.email}\n  patel=${patel.email}\n`);

  try {
    // ── 1. Public pages need no staging: shoot them first ─────────────────
    const pub = await pageFor(browser, DESKTOP);
    await shoot(pub, 'uc12-landing.png', { url: '/' });
    await shoot(pub, 'uc13-terms.png', { url: '/terms' });
    await shoot(pub, 'uc14-privacy.png', { url: '/privacy' });
    await shoot(pub, 'about.png', { url: '/about' });

    // ── 2. Margaret builds her vault the way UC-22/UC-01 describe ─────────
    await signUp(owner, 'Margaret Chen');
    await signIn(owner);
    check('Margaret signs up and signs in', owner.jar.has('next-auth.session-token'));

    /*
      The empty-state screens come BEFORE the vault fills. /vault/new is shot
      untouched: the type choice and the structured fields ARE the content.
    */
    const own = await pageFor(browser, DESKTOP, owner);
    await shoot(own, 'uc37-owner-vault-new.png', { url: '/vault/new' });

    /* The same arc the public demo tells, so the two never argue. */
    const fields: SecretField[] = [
      { kind: 'username', value: 'margaret.chen@fastmail.test' },
      { kind: 'password', value: 'correct-horse-battery-staple-8842' },
      { kind: 'totp', value: 'otpauth://totp/Fastmail:margaret?secret=JBSWY3DPEHPK3PXP&issuer=Fastmail' },
      { kind: 'recovery_codes', value: '8f2k-91mz\nq4rt-77bd\nzz10-4kkp' },
    ];
    const emailId = await saveEncrypted(owner, encodeSecretPayload(fields), {
      title: 'Primary email', type: 'login', service_name: 'Fastmail', category: 'communication',
    });
    const bankId = await saveEncrypted(
      owner,
      encodeSecretPayload([
        { kind: 'username', value: 'mchen1952' },
        { kind: 'password', value: 'seven-green-apples-42' },
      ]),
      { title: 'Checking account', type: 'login', service_name: 'First National', category: 'finance' },
    );
    const utilId = await saveEncrypted(
      owner,
      encodeSecretPayload([{ kind: 'username', value: 'mchen@utility.test' }, { kind: 'password', value: 'warm-house-11' }]),
      { title: 'Utilities', type: 'login', service_name: 'City Power & Water', category: 'utilities' },
    );
    const photosId = await saveEncrypted(
      owner,
      encodeSecretPayload([
        { kind: 'note', value: 'The originals are on the silver drive in the desk drawer; the album password is with them.' },
      ]),
      { title: 'Photo archive', type: 'document', service_name: 'Family photos', category: 'personal' },
    );
    check('four vault items saved through the real crypto path', Boolean(emailId && bankId && utilId && photosId));

    /* The two owner overrides that did not exist when uc01 was last shot. */
    const note = await owner.patch(`/api/vault/items/${bankId}`, {
      backup_note: 'The paper statements are in the fire safe — Sarah knows the code.',
    });
    check('a backup note lands on an existing item (V1/V4)', note.status === 200, `HTTP ${note.status}`);
    const irr = await owner.patch(`/api/vault/items/${photosId}`, { owner_set_irreplaceable: true });
    check('the owner marks the photos irreplaceable (034)', irr.status === 200, `HTTP ${irr.status}`);

    // ── 3. The circle: Sarah stands by, Dr Patel verifies ─────────────────
    const rec = await owner.post('/api/recipients', {
      name: 'Sarah Chen', email: sarah.email, relationship: 'child', phone: null, role: 'recipient',
    });
    const recipientId = String(
      (rec.body as { id?: string }).id ?? (rec.body as { recipient?: { id: string } }).recipient?.id,
    );
    for (const itemId of [emailId, bankId, utilId, photosId]) {
      const rule = await owner.post('/api/rules', {
        recipient_id: recipientId, vault_item_id: itemId,
        trigger_type: 'emergency', scope: 'view', reversible: true,
      });
      if (rule.status !== 201 && rule.status !== 200) {
        throw new Error(`rule for ${itemId}: ${rule.status}`);
      }
    }
    const ver = await owner.post('/api/verifiers', {
      name: 'Dr Patel', email: patel.email, phone: null, relationship: 'physician',
    });
    const verifierId = String(
      (ver.body as { id?: string }).id ?? (ver.body as { verifier?: { id: string } }).verifier?.id,
    );
    check('a recipient, four rules and a verifier exist', Boolean(recipientId && verifierId));

    const inv = await owner.post('/api/invitations', { personId: recipientId, personType: 'recipient' });
    const claimed = await claim(sarah, String(inv.body.claimCode));
    check('Sarah claims her standby account in calm', claimed.status === 200, `HTTP ${claimed.status}`);

    /*
      Confirmed, not merely claimed. The first run of this walk skipped this and
      every owner screenshot carried "Your plan cannot run yet — confirm a
      recipient who has already claimed": the banner was RIGHT, the staging was
      incomplete. Same lesson e2e-reveal.ts records for verifiers.
    */
    const confirmSarah = await owner.post(`/api/people/${recipientId}/confirm`, { personType: 'recipient' });
    check('Margaret confirms Sarah, so the plan can run', confirmSarah.status === 200, `HTTP ${confirmSarah.status}`);

    const vinv = await owner.post('/api/invitations', { personId: verifierId, personType: 'verifier' });
    const vclaimed = await claim(patel, String(vinv.body.claimCode));
    const confirmed = await owner.post(`/api/people/${verifierId}/confirm`, { personType: 'verifier' });
    check(
      'Dr Patel claims and Margaret confirms him — his answer will count',
      vclaimed.status === 200 && confirmed.status === 200,
      `claim ${vclaimed.status} confirm ${confirmed.status}`,
    );

    /*
      The claim screen is shot WITHOUT a token, deliberately. Arriving bare is
      the NORMAL path — the emailed link carries no credential, so most invitees
      meet the code form. Loading /claim?token=… is not photographable anyway:
      the page auto-claims on mount ("the bind IS the session"), which would
      spend a real invitation to take a picture. The first run of this walk did
      exactly that, and the spent fixture invitation is what exposed the
      double-fire defect now pinned in claim-copy.test.ts.
    */
    const claimPage = await pageFor(browser, PHONE);
    await shoot(claimPage, 'uc08-claim-phone.png', { url: '/claim', fullPage: false, settleMs: 1200 });

    // ── 4. Sarah becomes Margaret's helper, with consent recorded (I1) ────
    const su = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [sarah.email]);
    const sarahUserId = su.rows[0]?.id;
    const del = await owner.post('/api/delegations', { delegateUserId: sarahUserId });
    const delId = String((del.body as { id?: string }).id ?? (del.body as { delegation?: { id: string } }).delegation?.id);
    const consent = await owner.post(`/api/delegations/${delId}/consent`, {
      method: 'in_person', evidenceRef: 'Agreed at her kitchen table, Sunday afternoon',
    });
    check('Sarah is a helper and the consent record exists', del.status === 201 && consent.status === 200 || consent.status === 201, `del ${del.status} consent ${consent.status}`);
    await shoot(own, 'uc16-owner-helper-active.png', { url: '/approvals' });

    // ── 5. Import, run twice so the duplicate explanation renders (Q5) ────
    const csvPath = join(tmp, 'lastpass-export.csv');
    writeFileSync(
      csvPath,
      'url,username,password,totp,name,grouping\n' +
        'https://streaming.test,margaret.c,blue-window-97,,Streaming TV,\n' +
        'https://pharmacy.test,mchen1952,white-pill-box-3,,Pharmacy refills,\n',
    );
    const imp = await pageFor(browser, DESKTOP, owner);
    for (let run = 0; run < 2; run++) {
      await imp.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
      await imp.setInputFiles!('input[type="file"]', csvPath);
      await imp.getByRole('button', { name: /parse|preview/i }).first().click();
      await imp.getByText(/items to import/i).first().waitFor({ state: 'visible', timeout: 30_000 });
      await imp.getByRole('button', { name: /Encrypt & import/i }).first().click();
      /*
        The report, not a sleep. Each row does a KMS wrap; the first run of
        this walk slept 1500ms and photographed the "Importing…" progress bar.
      */
      await imp.getByText(/Imported \d|left \d+ already in your vault|already in your vault/i)
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });
    }
    const dupExplained = (await imp.getByText(/already in your vault/i).count()) > 0;
    check('the second import names the untouched duplicates (Q5)', dupExplained);
    await shoot(imp, 'uc33-owner-import.png', {});

    /* The vault, LAST among owner screens — every state above shows in it. */
    await shoot(own, 'uc01-owner-vault.png', { url: '/vault', settleMs: 1200 });

    // ── 6. The emergency, and what Sarah meets at 2am ─────────────────────
    const early = await sarah.post(`/api/access/${emailId}/decrypt`, {});
    check('before any release, Reveal is refused', early.status !== 200, `HTTP ${early.status}`);

    const fired = await owner.post('/api/triggers/emergency/initiate', {});
    check('Margaret starts an emergency herself', fired.status === 200, `HTTP ${fired.status}`);

    const releaseRow = await query<{ id: string }>(
      `SELECT rs.id FROM release_state rs JOIN users u ON u.id = rs.owner_id
        WHERE u.email = $1 AND rs.trigger_type = 'emergency'
        ORDER BY rs.created_at DESC LIMIT 1`,
      [owner.email],
    );
    const releaseStateId = releaseRow.rows[0]?.id;
    if (!releaseStateId) throw new Error('no release_state row for the fired emergency');

    /* Minted in-process, as e2e-reveal.ts explains: the verifier's surface is
       proven elsewhere; the mail this replaces is undeliverable by design. */
    const verifierToken = await issueVerifierToken(verifierId, releaseStateId);
    const vconf = await sarah.post(`/api/triggers/${releaseStateId}/confirm`, {
      verifier_token: verifierToken, method: 'email', decision: 'confirm',
    });
    const outcome = vconf.body as { status?: string; received?: number };
    check(
      'Dr Patel confirms and the tally advances',
      vconf.status === 200 && outcome.status !== 'not_counted' && (outcome.received ?? 0) >= 1,
      `HTTP ${vconf.status} ${outcome.status ?? ''}`,
    );
    const after = await query<{ state: string }>(`SELECT state FROM release_state WHERE id = $1`, [releaseStateId]);
    check('the release reaches RELEASED', after.rows[0]?.state === 'released', `state=${after.rows[0]?.state}`);

    /*
      The 2am screens, on the phone J8 specifies. The dashboard first; then
      Reveal on the primary email, which since Phase 0 must render LABELLED
      fields — a masked password and a live one-time code, not a wall of JSON.
    */
    const acc = await pageFor(browser, PHONE, sarah);
    /*
      The dashboard opens with its limits, and the limits come FIRST — "what
      this is, and what it is not", acknowledged before any item is shown. The
      first run of this walk photographed that screen believing it was the
      plan, which is exactly why it is now its own picture.
    */
    await acc.goto(`${BASE}/access`, { waitUntil: 'networkidle' });
    await acc.getByText(/what it is not/i).first().waitFor({ state: 'visible', timeout: 20_000 });
    await shoot(acc, 'access-limits-phone.png', { fullPage: false, settleMs: 600 });
    await acc.getByRole('button', { name: /I understand/i }).first().click();
    await acc.getByRole('button', { name: /reveal/i }).first().waitFor({ state: 'visible', timeout: 20_000 });
    await shoot(acc, 'uc22-recipient-access-open.png', { fullPage: false, settleMs: 800 });
    await acc.getByRole('button', { name: /reveal/i }).first().click();
    await acc.getByText(/one-time code|password/i).first().waitFor({ state: 'visible', timeout: 15_000 });
    const codeShown = (await acc.getByText(/\b\d{6}\b/).count()) > 0;
    check('Reveal shows labelled fields with a live six-digit code', codeShown);
    await shoot(acc, 'uc38-recipient-reveal-phone.png', { fullPage: false, settleMs: 400 });

    // ── 7. Margaret checks in and it all closes (UC-16's promise) ─────────
    const checkin = await owner.call('/api/checkin', { method: 'PUT' });
    check('the owner checks in and the release closes', checkin.status === 200, `HTTP ${checkin.status}`);
  } finally {
    console.log('\n── cleanup ──');
    try { await closeContact(sarah); } catch (e) { console.log(`  cleanup sarah: ${(e as Error).message}`); }
    try { await closeContact(patel); } catch (e) { console.log(`  cleanup patel: ${(e as Error).message}`); }
    try { await closeOwner(owner); } catch (e) { console.log(`  cleanup owner: ${(e as Error).message}`); }
    /* Fixture emails share one recognisable stem; anything the product-path
       deletes missed is reported, not silently left. */
    /*
      Backstop, not the plan: the product's own deletion path above is the walk
      of UC-20 and stays first. But a fixture row the closures missed must not
      outlive the run — the first run left one (a user minted by a claim the
      browser abandoned), and a leftover on this cluster is a row on PRODUCTION.
      Scoped to this run's own stamp; the same purge-by-fixture-email precedent
      family-arc.ts set.
    */
    const leftovers = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email LIKE $1`, [`relay-shoot-%-${stamp}@relay.test`],
    );
    for (const row of leftovers.rows) {
      await query(`DELETE FROM users WHERE id = $1`, [row.id]);
      console.log(`  purged leftover fixture user: ${row.email}`);
    }
    if (!leftovers.rows.length) console.log('  cluster clean: no fixture rows remain');
    rmSync(tmp, { recursive: true, force: true });
    await browser.close();
    await closeAllPools();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
