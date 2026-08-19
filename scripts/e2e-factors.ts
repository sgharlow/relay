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
  /*
    Optional on the WIRE, required when handed to `assessPreparedness` — the
    list API may be older than this script. `?? null` at the call site is the
    seam between the two, and it is written out rather than inferred because
    the day these were optional on the rule's own input, a caller forgot to
    select them and the whole rule went inert on the banner (2026-08-18).
  */
  secret_kinds?: string | null;
  factors_required?: string | null;
  depends_on_item_id?: string | null;
}

/** The shape the rule demands, from the shape the API returns. */
function forPreparedness(items: ListItem[]) {
  return items.map((i) => ({
    ...i,
    secret_kinds: i.secret_kinds ?? null,
    factors_required: i.factors_required ?? null,
    depends_on_item_id: i.depends_on_item_id ?? null,
  }));
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
      items: forPreparedness(afterCreate.items),
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
      items: forPreparedness(afterDeclare.items),
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

    /*
      🔴 THE UPDATE-PATH DEFECT, PROVEN FIXED END TO END — the reason this was a
      merge blocker rather than next-sprint debt. Create an item that HOLDS a
      code and demands one (usable), then re-encrypt it with the code removed —
      exactly what an owner does editing a TOTP seed away. Before the fix, the
      update path never rewrote secret_kinds, so the declaration stayed
      `password,totp` over a blob that no longer held it and the item kept
      reading `usable` on a code it could not produce. Now the declaration is
      derived at the choke point on every encrypt, so the re-encrypt refreshes
      it and the item correctly becomes unreachable.
    */
    const svc2 = new CryptoService(fetchAs());
    const withCode = await svc2.encryptForUpload(
      encodeSecretPayload([
        { kind: 'username', value: 'edit.me@fastmail.test' },
        { kind: 'password', value: 'first-password-77' },
        { kind: 'totp', value: 'otpauth://totp/Fastmail:edit?secret=JBSWY3DPEHPK3PXP&issuer=Fastmail' },
      ]),
      { type: 'login', title: 'Editable email', service_name: 'Fastmail', category: 'communication', criticality: 'critical' } as never,
    );
    const editable = await post('/api/vault/items', withCode);
    const editId = String((editable.body as { id?: string }).id);
    check('the derived declaration includes totp on create', (withCode as { secret_kinds?: string }).secret_kinds === 'password,totp,username', String((withCode as { secret_kinds?: string }).secret_kinds));

    await post('/api/rules', { recipient_id: recipientId, vault_item_id: editId, trigger_type: 'emergency', scope: 'view', reversible: true });
    await patch(`/api/vault/items/${editId}`, { factors_required: ['totp'] });

    const beforeEdit = (await call('/api/vault/items')).body as { items: ListItem[] };
    const bEdit = assessPreparedness({ items: forPreparedness(beforeEdit.items), ruledItemIds: [itemId, editId], verifierCount: 1 });

    // Re-encrypt WITHOUT the code — the edit-away. PUT re-derives.
    const withoutCode = await svc2.encryptForUpload(
      encodeSecretPayload([
        { kind: 'username', value: 'edit.me@fastmail.test' },
        { kind: 'password', value: 'rotated-password-88' },
      ]),
      { type: 'login', title: 'Editable email', service_name: 'Fastmail', category: 'communication', criticality: 'critical' } as never,
    );
    const put = await call(`/api/vault/items/${editId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(withoutCode),
    });
    check('the re-encrypt is accepted', put.status === 200, `HTTP ${put.status}`);

    const afterEdit = (await call('/api/vault/items')).body as { items: ListItem[] };
    const editedItem = afterEdit.items.find((i) => i.id === editId);
    check(
      'the declaration REFRESHED on re-encrypt — no longer claims a code it dropped',
      editedItem?.secret_kinds === 'password,username',
      `secret_kinds=${JSON.stringify(editedItem?.secret_kinds)}`,
    );

    const aEdit = assessPreparedness({ items: forPreparedness(afterEdit.items), ruledItemIds: [itemId, editId], verifierCount: 1 });
    check(
      '🔴 THE MERGE BLOCKER: editing a code away makes the item unreachable, not a stale usable',
      bEdit.reachable > aEdit.reachable,
      `reachable ${bEdit.reachable} -> ${aEdit.reachable} (the edited item dropped out)`,
    );

    /*
      And the boundary refuses a raw write with no declaration — the fail-closed
      half. A well-formed base64 payload that skipped the service is rejected.
    */
    const raw = await post('/api/vault/items', {
      type: 'login', title: 'Bypass', ciphertext: 'AAAA', wrapped_data_key: 'AAAA',
      kms_key_id: 'arn:aws:kms:us-east-1:1:key/abc',
    });
    check('a write that skips the crypto boundary is refused (fail closed)', raw.status === 400, `HTTP ${raw.status}`);
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
