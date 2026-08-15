/**
 * Standing by for two people at once, walked end to end.
 *
 * Builds the situation the multi-owner fix exists for and could not previously
 * be tested against: ONE contact who has claimed a standby role for TWO owners,
 * both of whom then have an open release at the same time. Before the fix the
 * resolver took `LIMIT 1` with no tiebreak, so that contact saw an arbitrary one
 * and had no way to reach the other.
 *
 * Two disposable owners and one disposable contact, all on RFC 6761 reserved
 * domains that can never receive mail, deleted at the end. Invitations are
 * owner-delivered in beta, so the claim code comes back in the API response and
 * nothing is emailed.
 *
 * ⚠️ Writes to whatever `E2E_BASE` points at, and `.env.local` points at the
 * production cluster. Three disposable accounts, all deleted at the end.
 *
 * It found a defect on its first run that no unit test could: `?owner=` naming
 * somebody the contact does not stand by for fell through to the closure branch
 * and reported "That access has closed" to a contact with two releases open.
 * The bug was in which BRANCH execution reached, and every test on that path
 * mocks the resolver.
 *
 *   npx tsx --env-file=.env.local scripts/e2e-multiowner.ts
 */
import { generateTotpCodeFor } from '../lib/auth/totp';
import { closeAllPools } from '../lib/db/connection';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';

const RESERVED = ['test', 'invalid', 'localhost'];
function undeliverable(address: string): string {
  if (!RESERVED.includes(address.split('.').pop() as string)) {
    throw new Error(`refusing to use ${address}: not a reserved, undeliverable domain`);
  }
  return address;
}

/** One cookie jar per actor — two owners and a contact are three browsers. */
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
      body = { _raw: text.slice(0, 160) };
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
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(60)} ${detail}`);
}

async function signUp(a: Actor): Promise<void> {
  const begin = await a.post('/api/auth/signup', { email: a.email, displayName: a.label });
  if (begin.status !== 201) throw new Error(`${a.label} signup begin ${begin.status}`);
  const secret = new URL(String(begin.body.otpauthUrl).replace('otpauth://', 'https://'))
    .searchParams.get('secret');
  if (!secret) throw new Error('no secret');
  a.secret = secret;
  const done = await a.call('/api/auth/signup', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrolmentToken: begin.body.enrolmentToken, code: generateTotpCodeFor(secret) }),
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

/** Redeem a claim code through the standby-claim credentials provider. */
async function claim(a: Actor, code: string, existingUserId?: string) {
  const csrf = await a.call('/api/auth/csrf');
  return a.call('/api/auth/callback/standby-claim', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken: String(csrf.body.csrfToken),
      token: code,
      ...(existingUserId ? { existingUserId } : {}),
      json: 'true',
      callbackUrl: BASE,
    }).toString(),
  });
}

/** Owner setup: an item, a recipient sharing CONTACT's address, and a rule. */
async function prepareOwner(o: Actor, contactEmail: string): Promise<string> {
  await signUp(o);
  await signIn(o);

  const item = await o.post('/api/vault/items', {
    title: `${o.label} primary email`,
    type: 'account',
    service_name: 'Fastmail',
    category: 'communication',
    ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==',
    wrapped_data_key: 'AAAAAAAAAAAA',
    kms_key_id: 'e2e-placeholder',
  });
  if (item.status !== 201 && item.status !== 200) throw new Error(`${o.label} item ${item.status} ${JSON.stringify(item.body)}`);

  const rec = await o.post('/api/recipients', {
    name: `Contact for ${o.label}`,
    email: contactEmail,
    relationship: 'child',
    phone: null,
    role: 'executor',
  });
  if (rec.status !== 201 && rec.status !== 200) throw new Error(`${o.label} recipient ${rec.status} ${JSON.stringify(rec.body)}`);
  const recipientId = String((rec.body as { id?: string }).id ?? (rec.body as { recipient?: { id: string } }).recipient?.id);

  const itemId = String((item.body as { id?: string }).id ?? (item.body as { item?: { id: string } }).item?.id);
  const rule = await o.post('/api/rules', {
    recipient_id: recipientId,
    vault_item_id: itemId,
    trigger_type: 'emergency',
    scope: 'view',
    reversible: true,
  });
  if (rule.status !== 201 && rule.status !== 200) {
    // The rule is what provisions the ARMED release_state (POST /api/rules calls
    // ensureReleaseState). Without it there is nothing to fire, and the failure
    // used to be invisible here — the trigger then 404'd for a reason two steps
    // upstream.
    throw new Error(
      `${o.label} rule ${rule.status} ${JSON.stringify(rule.body)} ` +
        `[recipientId=${recipientId} itemId=${itemId}]`,
    );
  }

  const inv = await o.post('/api/invitations', { personId: recipientId, personType: 'recipient' });
  if (inv.status !== 201) throw new Error(`${o.label} invitation ${inv.status} ${JSON.stringify(inv.body)}`);
  return String(inv.body.claimCode);
}

async function closeOwner(o: Actor): Promise<void> {
  // An owner whose signup never completed has no secret and nothing to close.
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

/**
 * Close the standby contact, using the session the claim already gave them.
 *
 * They hold no second factor at all, so step-up stands down — the guard is
 * unsatisfiable for this population by construction, and refusing them the
 * ability to close their own account would break the promise on the privacy
 * page. This is that path, exercised.
 */
async function closeContact(c: Actor): Promise<void> {
  const res = await c.call('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: c.email }),
  });
  console.log(`  cleanup: ${c.email} (contact) -> HTTP ${res.status}`);
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const contactEmail = undeliverable(`relay-contact-${stamp}@relay.test`);
  const a = new Actor('Owner A', undeliverable(`relay-owner-a-${stamp}@relay.test`));
  const b = new Actor('Owner B', undeliverable(`relay-owner-b-${stamp}@relay.test`));
  const c = new Actor('Contact', contactEmail);

  console.log(`base=${BASE}\n  A=${a.email}\n  B=${b.email}\n  C=${c.email}\n`);

  try {
    const codeA = await prepareOwner(a, contactEmail);
    const codeB = await prepareOwner(b, contactEmail);
    check('two owners each name the same contact', Boolean(codeA && codeB), 'claim codes issued');

    // ---- The contact claims BOTH, linking rather than forking an account ----
    const claim1 = await claim(c, codeA);
    check('contact claims the first standby role', claim1.status === 200, `HTTP ${claim1.status}`);

    const sess = await c.call('/api/auth/session');
    const contactUserId = String((sess.body as { ownerId?: string }).ownerId ?? '');
    check('claiming yields a session for the contact', Boolean(contactUserId), contactUserId.slice(0, 8));

    const claim2 = await claim(c, codeB, contactUserId);
    check('second role LINKS to the same account', claim2.status === 200, `HTTP ${claim2.status}`);

    // ---- Nothing is open yet -------------------------------------------
    const calm = await c.call('/api/access');
    check(
      'with nothing open, no picker is offered',
      calm.body.choose === undefined,
      `HTTP ${calm.status} ${String(calm.body.error ?? '')}`,
    );

    // ---- Both owners fire ------------------------------------------------
    for (const o of [a, b]) {
      await signIn(o);
      const fired = await o.post(`/api/triggers/emergency/initiate`, {});
      check(`${o.label} fires an emergency`, fired.status === 200, `HTTP ${fired.status}`);
    }

    // ---- THE DEFECT: two open releases at once ---------------------------
    const both = await c.call('/api/access');
    const releases = (both.body.releases as Array<{ ownerId: string; ownerLabel: string }>) ?? [];
    check(
      'contact is OFFERED the choice, not handed one at random',
      both.status === 403 && both.body.error === 'ChooseOwner' && releases.length === 2,
      `HTTP ${both.status} ${String(both.body.error ?? '')} n=${releases.length}`,
    );
    check(
      'both owners are named, by label not id',
      releases.every((r) => r.ownerLabel && r.ownerLabel !== r.ownerId),
      releases.map((r) => r.ownerLabel).join(' | '),
    );

    // Determinism: the same request twice must give the same order.
    const again = await c.call('/api/access');
    const order1 = releases.map((r) => r.ownerId).join(',');
    const order2 = ((again.body.releases as Array<{ ownerId: string }>) ?? []).map((r) => r.ownerId).join(',');
    check('the order is deterministic between requests', order1 === order2, order1 === order2 ? 'stable' : `${order1} vs ${order2}`);

    // ---- Choosing each one reaches THAT owner's plan ----------------------
    for (const r of releases) {
      const picked = await c.call(`/api/access?owner=${encodeURIComponent(r.ownerId)}`);
      const label = String((picked.body as { ownerLabel?: string }).ownerLabel ?? '');
      check(
        `choosing ${r.ownerLabel} reaches that owner's plan`,
        picked.status === 200 || (picked.status === 403 && picked.body.pending === true),
        `HTTP ${picked.status} ${label || String(picked.body.error ?? '')}`,
      );
    }

    /*
      A crafted owner id must resolve NOTHING — and must not be described as a
      CLOSURE. Before 2026-08-15 this fell through to the graceful-close branch
      and told a contact with two live releases "That access has closed because
      they checked back in", which is a sentence about an event that did not
      happen. Found by this walk; no unit test could see it, because the bug
      lived in which branch execution reached.
    */
    const forged = await c.call(`/api/access?owner=00000000-0000-4000-8000-000000000000`);
    check(
      'an owner this contact does not stand by for resolves nothing',
      forged.status !== 200,
      `HTTP ${forged.status} ${String(forged.body.error ?? '')}`,
    );
    check(
      'and is re-asked the question, NOT told their access closed',
      forged.body.error === 'ChooseOwner' && forged.body.closed === undefined,
      `${String(forged.body.error ?? '')} closed=${String(forged.body.closed)}`,
    );
  } finally {
    console.log('');
    /*
      🔴 THE CONTACT USED TO BE LEFT BEHIND. The first four runs of this script
      deleted both owners and forgot C — a standby account minted by `upsertUser`
      during the claim, which the script never created explicitly and therefore
      never thought to remove. Four orphans on the production cluster before
      anybody looked.

      C holds neither a TOTP secret nor a passkey, so `requireStepUpOnce` stands
      down for them and closing needs only the session they already have. That
      is not a shortcut around the guard — it is the documented stand-down, and
      cleaning up this way exercises it.
    */
    await closeContact(c).catch((e) => console.log('  cleanup C failed:', e.message));
    await closeOwner(a).catch((e) => console.log('  cleanup A failed:', e.message));
    await closeOwner(b).catch((e) => console.log('  cleanup B failed:', e.message));
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
