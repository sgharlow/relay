/**
 * Step-up elevation, walked end to end as a real signed-in owner.
 *
 * ⚠️ THIS WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at
 * the production cluster. It creates a disposable owner and deletes it again;
 * nothing else is touched, and every address is on a reserved domain that
 * lib/notify/email.ts refuses at the send seam, so no mail is attempted and no
 * sending reputation is spent.
 *
 * It is tracked rather than thrown away because it is the only thing that
 * proves this flow: the guard returning 403 correctly and a prompt nobody can
 * answer look identical from the server side, and a unit test cannot tell them
 * apart either.
 *
 * Creates a DISPOSABLE owner through the ordinary signup API, signs in through
 * NextAuth with a real TOTP code, exercises every branch of the elevation flow
 * over HTTP, then closes the account — which is itself the last assertion,
 * because closing requires elevation and SPENDS it.
 *
 * Same practice as the 2026-08-08 and 2026-08-13 production sweeps: a
 * throwaway owner, created and deleted for the purpose. Nothing is emailed —
 * invitations are owner-delivered in beta and this account names nobody.
 *
 *   npx tsx --env-file=.env.local scripts/e2e-stepup.ts
 */
import { generateTotpCodeFor } from '../lib/auth/totp';
import { closeAllPools } from '../lib/db/connection';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const EMAIL = `relay-stepup-e2e-${Date.now()}@relay.test`;

/**
 * A HARNESS MUST NOT BE ABLE TO ADDRESS A REAL DOMAIN.
 *
 * `.test` is RFC 6761 reserved and permanently undeliverable, and
 * lib/notify/email.ts refuses it at the send seam so no attempt ever reaches
 * Resend — which is why a throwaway account costs no sending reputation. That
 * guard protects the PRODUCT; this one protects the SCRIPT, because the failure
 * mode here is somebody editing this line to a real-looking address and
 * spending reputation on a bounce that suppresses a recipient forever.
 *
 * Structure rather than care: the address cannot be wrong, rather than being
 * remembered to be right.
 */
const RESERVED = ['test', 'invalid', 'localhost'];
if (!RESERVED.includes(EMAIL.split('.').pop() as string)) {
  throw new Error(`refusing to run: ${EMAIL} is not a reserved, undeliverable domain`);
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

function cookieHeader(): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown>; res: Response }> {
  const res = await fetch(BASE + path, {
    ...init,
    redirect: 'manual',
    headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
  });
  remember(res);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text.slice(0, 120) };
  }
  return { status: res.status, body, res };
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(58)} ${detail}`);
}

async function main(): Promise<void> {
  console.log(`base=${BASE}  owner=${EMAIL}\n`);

  // ---- 1. Create a disposable owner through the real signup API -----------
  const begin = await call('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, displayName: 'Step-up E2E' }),
  });
  if (begin.status !== 201) throw new Error(`signup begin ${begin.status} ${JSON.stringify(begin.body)}`);

  const otpauth = String(begin.body.otpauthUrl);
  const secret = new URL(otpauth.replace('otpauth://', 'https://')).searchParams.get('secret');
  if (!secret) throw new Error('no secret in otpauth url');

  const done = await call('/api/auth/signup', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrolmentToken: begin.body.enrolmentToken, code: generateTotpCodeFor(secret) }),
  });
  check('signup completes with a real TOTP code', done.status === 200, `HTTP ${done.status}`);

  // ---- 2. Sign in through NextAuth, as the sign-in form does --------------
  const csrf = await call('/api/auth/csrf');
  const form = new URLSearchParams({
    csrfToken: String(csrf.body.csrfToken),
    email: EMAIL,
    totpCode: generateTotpCodeFor(secret),
    json: 'true',
    callbackUrl: BASE,
  });
  const signin = await call('/api/auth/callback/email-totp', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const hasSession = [...jar.keys()].some((k) => k.includes('session-token'));
  check('email+TOTP sign-in yields a session', hasSession, `HTTP ${signin.status}`);
  if (!hasSession) throw new Error('no session cookie — cannot continue');

  // ---- 3. THE DEFECT THIS CLOSES: a 24h session is not enough ------------
  const exportCold = await call('/api/account/export');
  check(
    'export REFUSED on an ordinary session',
    exportCold.status === 403 && exportCold.body.error === 'StepUpRequired',
    `HTTP ${exportCold.status} ${String(exportCold.body.error ?? '')}`,
  );

  const codesCold = await call('/api/account/recovery-codes', { method: 'POST' });
  check(
    'new recovery codes REFUSED on an ordinary session',
    codesCold.status === 403 && codesCold.body.error === 'StepUpRequired',
    `HTTP ${codesCold.status} ${String(codesCold.body.error ?? '')}`,
  );

  // 403 and not 401: the session is valid, and answering 401 would send the
  // client's generic handler to sign-in and destroy it.
  check('refusal is 403, never 401', exportCold.status === 403, `HTTP ${exportCold.status}`);

  // ---- 4. What the prompt offers -----------------------------------------
  const factors = await call('/api/account/step-up');
  const f = factors.body.factors as { totp?: boolean; passkey?: boolean } | undefined;
  check(
    'step-up reports the factors this account holds',
    factors.status === 200 && f?.totp === true && f?.passkey === false,
    JSON.stringify(f),
  );
  check('and reports it is not yet elevated', factors.body.elevated === false, String(factors.body.elevated));

  // ---- 5. A wrong code does not elevate ----------------------------------
  const wrong = await call('/api/account/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ totpCode: '000000' }),
  });
  check('a wrong code is refused', wrong.status === 400, `HTTP ${wrong.status}`);

  // ---- 6. Elevate for real ------------------------------------------------
  const up = await call('/api/account/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ totpCode: generateTotpCodeFor(secret) }),
  });
  check('a correct code elevates', up.status === 200 && up.body.elevated === true, `HTTP ${up.status}`);
  check('elevation arrives as a cookie', jar.has('relay_step_up'), jar.has('relay_step_up') ? 'set' : 'MISSING');

  // ---- 7. The window is a window: both actions pass, without re-prompting --
  const exportHot = await call('/api/account/export');
  check('export SUCCEEDS while elevated', exportHot.status === 200, `HTTP ${exportHot.status}`);

  const codesHot = await call('/api/account/recovery-codes', { method: 'POST' });
  const sheet = (codesHot.body.recoveryCodes as string[] | undefined) ?? [];
  check(
    'recovery codes issue on the SAME elevation — no second prompt',
    codesHot.status === 200 && sheet.length > 0,
    `HTTP ${codesHot.status}, ${sheet.length} codes`,
  );

  // ---- 8. Revocation is immediate ----------------------------------------
  const revoke = await call('/api/account/step-up', { method: 'DELETE' });
  check('sign-out path revokes elevation server-side', revoke.status === 200, `HTTP ${revoke.status}`);

  const exportAfterRevoke = await call('/api/account/export');
  check(
    'export REFUSED again after revoke — the row, not the cookie, decides',
    exportAfterRevoke.status === 403,
    `HTTP ${exportAfterRevoke.status}`,
  );

  // ---- 9. Closure spends its elevation ------------------------------------
  await call('/api/account/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ totpCode: generateTotpCodeFor(secret) }),
  });

  const wrongEmail = await call('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: 'not-my-address@example.com' }),
  });
  check('closure still refuses a mistyped address', wrongEmail.status === 400, `HTTP ${wrongEmail.status}`);

  // The elevation must SURVIVE that refusal — it is spent only on success, or a
  // typo would cost a re-authentication.
  const closed = await call('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: EMAIL }),
  });
  check(
    'account closes, and the typo did not burn the elevation',
    closed.status === 200,
    `HTTP ${closed.status}`,
  );

  // ---- 10. And the session is dead ---------------------------------------
  const after = await call('/api/account/step-up');
  check('the deleted account cannot use its session', after.status === 401, `HTTP ${after.status}`);

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
