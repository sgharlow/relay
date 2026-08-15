/**
 * Create or close a disposable owner, so owner mode can be audited.
 *
 * `scripts/a11y-audit.mjs` needs a real session and had `demo@relay.test`
 * hardcoded; that account is gone, so owner mode had silently stopped being
 * audited. This makes the account the audit needs, through the ordinary signup
 * API — the same throwaway-owner practice the 2026-08-08 and 2026-08-13
 * production sweeps used.
 *
 * It also populates a little: an empty vault renders empty states, and an empty
 * state is a different page from the one a real owner sees. A few items and a
 * named contact exercise the lists, badges and tables that carry most of the
 * accessibility risk.
 *
 * ⚠️ Writes to whatever `E2E_BASE` points at, and `.env.local` points at the
 * production cluster. Every address is on a reserved domain, asserted below.
 *
 *   npx tsx --env-file=.env.local scripts/disposable-owner.ts create
 *   A11Y_OWNER_EMAIL=<that address> node scripts/a11y-audit.mjs
 *   npx tsx --env-file=.env.local scripts/disposable-owner.ts close <email> <secret>
 */
import { generateTotpCodeFor } from '../lib/auth/totp';
import { closeAllPools } from '../lib/db/connection';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';

/**
 * Every address this script invents must be permanently undeliverable.
 *
 * `.test` is RFC 6761 reserved and lib/notify/email.ts refuses it at the send
 * seam, so nothing reaches Resend and no sending reputation is spent. That
 * guard protects the product; this one protects the script, so a later edit
 * cannot point a throwaway account at a real domain and buy a hard bounce —
 * which suppresses that recipient forever while the send still returns 200.
 */
const RESERVED = ['test', 'invalid', 'localhost'];
export function assertUndeliverable(address: string): string {
  if (!RESERVED.includes(address.split('.').pop() as string)) {
    throw new Error(`refusing to use ${address}: not a reserved, undeliverable domain`);
  }
  return address;
}

const jar = new Map<string, string>();

function remember(res: Response): void {
  for (const [k, v] of res.headers) {
    if (k.toLowerCase() !== 'set-cookie') continue;
    for (const part of v.split(/,(?=[^;]+?=)/)) {
      const [pair] = part.trim().split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    redirect: 'manual',
    headers: {
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(init.headers ?? {}),
    },
  });
  remember(res);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

const json = (b: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
});

async function signIn(email: string, secret: string): Promise<void> {
  const csrf = await call('/api/auth/csrf');
  await call('/api/auth/callback/email-totp', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken: String(csrf.body.csrfToken),
      email,
      totpCode: generateTotpCodeFor(secret),
      json: 'true',
      callbackUrl: BASE,
    }).toString(),
  });
}

async function create(): Promise<void> {
  const email = assertUndeliverable(`relay-a11y-${Date.now()}@relay.test`);

  const begin = await call('/api/auth/signup', json({ email, displayName: 'A11y Audit' }));
  if (begin.status !== 201) throw new Error(`signup begin ${begin.status}`);

  const secret = new URL(String(begin.body.otpauthUrl).replace('otpauth://', 'https://'))
    .searchParams.get('secret');
  if (!secret) throw new Error('no secret');

  const done = await call(
    '/api/auth/signup',
    { ...json({ enrolmentToken: begin.body.enrolmentToken, code: generateTotpCodeFor(secret) }), method: 'PUT' },
  );
  if (done.status !== 200) throw new Error(`signup complete ${done.status}`);

  await signIn(email, secret);

  /*
    Enough to render populated screens. Ciphertext is placeholder bytes — this
    account is never decrypted, only LOOKED at, and axe reads the accessibility
    tree rather than the plaintext.
  */
  for (const item of [
    { title: 'Primary email', type: 'account', service_name: 'Fastmail', category: 'email' },
    { title: 'Main bank', type: 'account', service_name: 'Chase', category: 'finance' },
    { title: 'House insurance', type: 'document', service_name: 'Aviva', category: 'insurance' },
  ]) {
    await call(
      '/api/vault/items',
      json({ ...item, ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==', wrapped_data_key: 'AAAAAAAAAAAA', kms_key_id: 'audit-placeholder' }),
    );
  }

  await call(
    '/api/recipients',
    json({ name: 'Sam Rivera', email: assertUndeliverable('sam@relay.test'), relationship: 'family' }),
  );
  await call(
    '/api/verifiers',
    json({ name: 'Dr Ade Okafor', email: assertUndeliverable('ade@relay.test') }),
  );

  console.log(`EMAIL ${email}`);
  console.log(`SECRET ${secret}`);
}

async function close(email: string, secret: string): Promise<void> {
  await signIn(email, secret);
  await call('/api/account/step-up', json({ totpCode: generateTotpCodeFor(secret) }));
  const res = await call('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: email }),
  });
  console.log(`CLOSED ${email} -> HTTP ${res.status}`);
  if (res.status !== 200) process.exitCode = 1;
}

const [cmd, arg, arg2] = process.argv.slice(2);
(cmd === 'close' ? close(arg, arg2) : create())
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
