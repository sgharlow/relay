/**
 * The 035 columns, proven through the real stack rather than through mocks.
 *
 * WHY THIS EXISTS. `usability.ts` and `preparedness.ts` shipped on 2026-08-17
 * fully tested and completely inert: no SELECT returned the columns and no
 * client wrote them, so the rule never fired and every unit test passed
 * throughout. A suite cannot see that. This walk writes a declaration through
 * the browser's own create path, reads it back through the list API, and
 * asserts the preparedness sentence changes — the whole point of the migration.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * PRODUCTION cluster (Relay has no dev database). The fixture lives on an
 * RFC 6761 `.test` address, which `assertDeliverableDomain` refuses at the mail
 * seam, and it is deleted through the product's own closure path in a `finally`.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/e2e-factors.ts
 */
import { encodeSecretPayload, secretKindsOf, type SecretField } from '../lib/crypto/secret-payload';
import { generateTotpCodeFor } from '../lib/auth/totp';
import { CryptoService } from '../lib/crypto/crypto-service';
import { assessPreparedness } from '../lib/vault/preparedness';
import { closeAllPools } from '../lib/db/connection';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(64)} ${detail}`);
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
    body = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

const post = (path: string, b: unknown) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const patch = (path: string, b: unknown) =>
  call(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

function fetchAs(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    return fetch(path.startsWith('http') ? path : BASE + path, {
      ...init,
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(init?.headers ?? {}) },
    });
  }) as typeof fetch;
}

interface ListItem {
  id: string;
  title: string;
  criticality: string | null;
  is_root_credential: boolean;
  secret_kinds?: string | null;
  factors_required?: string | null;
}

async function main(): Promise<void> {
  const email = undeliverable(`relay-factors-${Date.now()}@relay.test`);
  let secret = '';
  console.log(`base=${BASE}\n  owner=${email}\n`);

  try {
    const begin = await post('/api/auth/signup', { email, displayName: 'Factors Owner' });
    if (begin.status !== 201) throw new Error(`signup begin ${begin.status}`);
    secret = new URL(String(begin.body.otpauthUrl).replace('otpauth://', 'https://')).searchParams.get('secret') as string;
    await call('/api/auth/signup', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrolmentToken: begin.body.enrolmentToken, code: generateTotpCodeFor(secret) }),
    });
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

    /*
      A password and NOTHING ELSE — the exact shape the falsehood was about.
      The TOTP field is deliberately present and empty, which is the case that
      exposed `secretKindsOf` declaring a factor the blob does not hold.
    */
    const fields: SecretField[] = [
      { kind: 'username', value: 'margaret.chen@fastmail.test' },
      { kind: 'password', value: 'seven-green-apples-42' },
      { kind: 'totp', value: '' },
    ];
    const declared = secretKindsOf(fields);
    check('an empty TOTP box is not declared as holding a code', declared === 'password,username', declared);

    const svc = new CryptoService(fetchAs());
    const payload = await svc.encryptForUpload(encodeSecretPayload(fields), {
      type: 'login',
      title: 'Primary email',
      service_name: 'Fastmail',
      category: 'communication',
      criticality: 'critical',
      secret_kinds: declared,
    } as never);
    const created = await post('/api/vault/items', payload);
    const itemId = String((created.body as { id?: string }).id);
    check('the browser path stores the declaration', created.status === 201 || created.status === 200, `HTTP ${created.status}`);

    const afterCreate = (await call('/api/vault/items')).body as { items: ListItem[] };
    const stored = afterCreate.items.find((i) => i.id === itemId);
    check(
      'a READ returns what the write stored — the leg that was missing',
      stored?.secret_kinds === 'password,username',
      `secret_kinds=${JSON.stringify(stored?.secret_kinds)}`,
    );
    check(
      'nobody has been asked what the account demands yet',
      stored?.factors_required == null,
      `factors_required=${JSON.stringify(stored?.factors_required)}`,
    );

    // Somebody can open it, so it is "openable" and counts toward the sentence.
    const rec = await post('/api/recipients', {
      name: 'Sarah', email: undeliverable(`relay-factors-kid-${Date.now()}@relay.test`),
      relationship: 'child', phone: null, role: 'recipient',
    });
    const recipientId = String((rec.body as { id?: string }).id);
    await post('/api/rules', {
      recipient_id: recipientId, vault_item_id: itemId,
      trigger_type: 'emergency', scope: 'view', reversible: true,
    });

    const before = assessPreparedness({
      items: afterCreate.items,
      ruledItemIds: [itemId],
      verifierCount: 1,
    });
    check('before the owner answers, the item counts as reachable', before.reachable === 1, `reachable=${before.reachable}`);

    // The owner answers: this account asks for a code as well.
    const declaredRes = await patch(`/api/vault/items/${itemId}`, { factors_required: ['totp'] });
    check('the owner can declare what the account demands', declaredRes.status === 200, `HTTP ${declaredRes.status}`);

    const bad = await patch(`/api/vault/items/${itemId}`, { factors_required: ['telepathy'] });
    check('an unrecognised factor is refused, not silently narrowed', bad.status === 400, `HTTP ${bad.status}`);

    const afterDeclare = (await call('/api/vault/items')).body as { items: ListItem[] };
    const declaredItem = afterDeclare.items.find((i) => i.id === itemId);
    check(
      'the declaration round-trips through the cluster',
      declaredItem?.factors_required === 'totp',
      `factors_required=${JSON.stringify(declaredItem?.factors_required)}`,
    );

    const after = assessPreparedness({
      items: afterDeclare.items,
      ruledItemIds: [itemId],
      verifierCount: 1,
    });
    check(
      '🔴 THE POINT: a password behind a coded door is no longer counted reachable',
      after.reachable === 0,
      `reachable ${before.reachable} -> ${after.reachable}`,
    );

    // And the owner can take the answer back.
    await patch(`/api/vault/items/${itemId}`, { factors_required: null });
    const reverted = (await call('/api/vault/items')).body as { items: ListItem[] };
    check(
      'the answer is revocable — back to never-asked, not to "demands nothing"',
      reverted.items.find((i) => i.id === itemId)?.factors_required == null,
      'factors_required=null',
    );
  } finally {
    if (secret) {
      await post('/api/account/step-up', { totpCode: generateTotpCodeFor(secret) });
      const del = await call('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: email }),
      });
      console.log(`\n  cleanup: ${email} -> HTTP ${del.status}`);
    }
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
