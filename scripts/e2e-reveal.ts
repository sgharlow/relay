/**
 * The moment the whole product exists for: a recipient presses Reveal.
 *
 * WHY THIS EXISTS, AND WHY THE OTHER THREE WALKS ARE NOT ENOUGH. J8 is the
 * primary demand journey and its evidence had gone stale in the most expensive
 * possible way. The last live proof of the decrypt round-trip is 2026-08-08, and
 * it proved a screen that NO LONGER EXISTS: secret-types Phase 0 replaced
 * `<pre>{value}</pre>` with labelled fields, a masked password, per-field copy
 * and a generated TOTP code. `e2e-ui.ts` says in its own header that it drives
 * the step-up dialog and the owner picker; `e2e-stepup` and `e2e-multiowner` are
 * HTTP walks over the server. None of them reveals anything.
 *
 * So the single most valuable interaction in Relay — a grieving person opening
 * an account at 2am — was covered by unit tests over `encode`/`decode` and by
 * nothing else. Unit tests cannot see a KMS unwrap, an access rule, a release
 * state, or the difference between a labelled field and a wall of JSON.
 *
 * WHAT IT ASSERTS, END TO END, THROUGH THE REAL STACK:
 *   1. An owner's structured secret survives the round trip byte for byte —
 *      in-browser AES-GCM, KMS wrap, DSQL, release, KMS unwrap, decrypt.
 *   2. It comes back as LABELLED FIELDS, not one opaque blob.
 *   3. The TOTP seed produces a live six-digit code that matches one computed
 *      independently from the same seed. Handing somebody a base32 string is
 *      useless; handing them a code is the difference between getting in and not.
 *   4. THE LEGACY IMPORT SHAPE DECODES TOO. `{"username":…,"password":…}` was
 *      being rendered raw to recipients until 2026-08-17 (§1.2 of the design).
 *      Every item imported before then is still stored in that shape and cannot
 *      ever be rewritten — the server cannot read it. If this assertion breaks,
 *      real stored items become unreadable.
 *   5. The password is marked for masking and the TOTP and recovery codes are
 *      not — the reveal shows what a person needs and hides what shoulder
 *      surfers do not.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, AND `.env.local` POINTS AT THE
 * PRODUCTION CLUSTER, because Relay has no dev database. It creates two
 * accounts on RFC 6761 reserved domains that can never receive mail, and closes
 * BOTH through the product's own deletion path in a `finally`. An early run of
 * `e2e-multiowner` left four contacts behind; that is the reason cleanup here is
 * unconditional and prints the HTTP status of every delete.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/e2e-reveal.ts
 */
import {
  encodeSecretPayload,
  decodeSecretPayload,
  MASKED_KINDS,
  valueOf,
  recoveryCodesOf,
  type SecretField,
} from '../lib/crypto/secret-payload';
import { parseOtpauth, generateTotp } from '../lib/crypto/totp';
import { generateTotpCodeFor } from '../lib/auth/totp';
import { issueVerifierToken } from '../lib/auth/verifier-token';
import { CryptoService, base64ToBytes, unpackIvCiphertext } from '../lib/crypto/crypto-service';
import { query, closeAllPools } from '../lib/db/connection';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';

const RESERVED = ['test', 'invalid', 'localhost'];
function undeliverable(address: string): string {
  if (!RESERVED.includes(address.split('.').pop() as string)) {
    throw new Error(`refusing to use ${address}: not a reserved, undeliverable domain`);
  }
  return address;
}

/** The secret an owner actually types. Distinctive so a partial match cannot pass. */
const SECRET = {
  username: 'margaret.chen@example.test',
  password: 'correct-horse-battery-staple-8842',
  totp: 'otpauth://totp/Fastmail:margaret?secret=JBSWY3DPEHPK3PXP&issuer=Fastmail',
  recoveryCodes: ['8f2k-91mz', 'q4rt-77bd', 'zz10-4kkp'],
};

/** The shape every item imported before 2026-08-17 is stored in, permanently. */
const LEGACY_PLAINTEXT = JSON.stringify({
  username: 'legacy.user@example.test',
  password: 'imported-from-lastpass-2211',
});

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

  /** A fetch the CryptoService can use: relative paths, this actor's cookies. */
  fetchAs(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const res = await fetch(path.startsWith('http') ? path : BASE + path, {
        ...init,
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(init?.headers ?? {}),
        },
      });
      return res;
    }) as typeof fetch;
  }
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(62)} ${detail}`);
}

async function signUp(a: Actor): Promise<void> {
  const begin = await a.post('/api/auth/signup', { email: a.email, displayName: a.label });
  if (begin.status !== 201) throw new Error(`${a.label} signup begin ${begin.status}`);
  const secret = new URL(String(begin.body.otpauthUrl).replace('otpauth://', 'https://')).searchParams.get(
    'secret',
  );
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

/** Encrypts in the browser's own path and saves. Returns the item id. */
async function saveEncrypted(owner: Actor, plaintext: string, title: string): Promise<string> {
  const svc = new CryptoService(owner.fetchAs());
  const payload = await svc.encryptForUpload(plaintext, {
    title,
    type: 'login',
    service_name: 'Fastmail',
    category: 'communication',
  } as never);
  const res = await owner.post('/api/vault/items', payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`save ${title}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return String((res.body as { id?: string }).id ?? (res.body as { item?: { id: string } }).item?.id);
}

/** What the recipient's browser does when Reveal is pressed. */
async function reveal(contact: Actor, itemId: string): Promise<string> {
  const res = await contact.post(`/api/access/${itemId}/decrypt`, {});
  if (res.status !== 200) {
    throw new Error(`decrypt ${itemId}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const { plaintext_data_key, ciphertext } = res.body as {
    plaintext_data_key: string;
    ciphertext: string;
  };
  const { iv, ciphertext: ct } = unpackIvCiphertext(base64ToBytes(ciphertext));
  return new CryptoService().decryptItem(ct, iv, plaintext_data_key);
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

async function main(): Promise<void> {
  const stamp = Date.now();
  const owner = new Actor('Reveal Owner', undeliverable(`relay-reveal-owner-${stamp}@relay.test`));
  const contact = new Actor('Reveal Contact', undeliverable(`relay-reveal-contact-${stamp}@relay.test`));
  const verifier = new Actor('Reveal Verifier', undeliverable(`relay-reveal-verifier-${stamp}@relay.test`));

  console.log(
    `base=${BASE}\n  owner=${owner.email}\n  contact=${contact.email}\n  verifier=${verifier.email}\n`,
  );

  try {
    // ---- The owner stores a secret the way a person actually would ---------
    await signUp(owner);
    await signIn(owner);

    const fields: SecretField[] = [
      { kind: 'username', value: SECRET.username },
      { kind: 'password', value: SECRET.password },
      { kind: 'totp', value: SECRET.totp },
      { kind: 'recovery_codes', value: SECRET.recoveryCodes.join('\n') },
    ];
    const structuredId = await saveEncrypted(owner, encodeSecretPayload(fields), 'Fastmail (structured)');
    const legacyId = await saveEncrypted(owner, LEGACY_PLAINTEXT, 'Imported login (legacy shape)');
    check('owner stores a structured secret and a legacy-shaped one', Boolean(structuredId && legacyId), `${structuredId.slice(0, 8)} / ${legacyId.slice(0, 8)}`);

    // ---- A recipient, a rule per item, and a verifier ----------------------
    const rec = await owner.post('/api/recipients', {
      name: 'Sarah',
      email: contact.email,
      relationship: 'child',
      phone: null,
      role: 'recipient',
    });
    const recipientId = String(
      (rec.body as { id?: string }).id ?? (rec.body as { recipient?: { id: string } }).recipient?.id,
    );

    for (const itemId of [structuredId, legacyId]) {
      const rule = await owner.post('/api/rules', {
        recipient_id: recipientId,
        vault_item_id: itemId,
        trigger_type: 'emergency',
        scope: 'view',
        reversible: true,
      });
      if (rule.status !== 201 && rule.status !== 200) {
        throw new Error(`rule for ${itemId}: ${rule.status} ${JSON.stringify(rule.body)}`);
      }
    }

    const ver = await owner.post('/api/verifiers', {
      name: 'Dr Patel',
      email: verifier.email,
      phone: null,
      relationship: 'physician',
    });
    const verifierId = String(
      (ver.body as { id?: string }).id ?? (ver.body as { verifier?: { id: string } }).verifier?.id,
    );
    check('a verifier exists to answer the question', Boolean(verifierId), `HTTP ${ver.status}`);

    const inv = await owner.post('/api/invitations', { personId: recipientId, personType: 'recipient' });
    const claimCode = String(inv.body.claimCode);
    const claimed = await claim(contact, claimCode);
    check('the recipient claims a standby account in calm', claimed.status === 200, `HTTP ${claimed.status}`);

    /*
      🔴 THE STEP THE FIRST DRAFT OF THIS WALK SKIPPED, AND THE PRODUCT WAS
      RIGHT TO REFUSE IT. A verifier's answer only advances the threshold once
      the OWNER has checked who they were speaking to: `isEligibleVerifier`
      requires `standby_state = 'confirmed'`, and an unconfirmed answer is
      recorded in the audit log while the tally stands still (`not_counted`,
      §4.3, tightened 2026-08-12). Skipping it left the release in grace and
      looked like a broken reveal — it was the quorum rule working.

      So the verifier claims their own standby account and the owner confirms
      them, which is J4 steps 7-8 walked rather than assumed.
    */
    const vinv = await owner.post('/api/invitations', { personId: verifierId, personType: 'verifier' });
    const vclaimed = await claim(verifier, String(vinv.body.claimCode));
    check('the verifier claims their place', vclaimed.status === 200, `HTTP ${vclaimed.status}`);

    const confirmedPerson = await owner.post(`/api/people/${verifierId}/confirm`, {
      personType: 'verifier',
    });
    check(
      'the owner confirms the verifier, so their answer will count',
      confirmedPerson.status === 200,
      `HTTP ${confirmedPerson.status} ${String((confirmedPerson.body as { message?: string }).message ?? '')}`,
    );

    // ---- Nothing is open. Reveal must refuse. ------------------------------
    const early = await contact.post(`/api/access/${structuredId}/decrypt`, {});
    check(
      'before any release, Reveal is refused',
      early.status !== 200,
      `HTTP ${early.status} ${String(early.body.error ?? '')}`,
    );

    // ---- The emergency, and the verifier who answers it --------------------
    const fired = await owner.post('/api/triggers/emergency/initiate', {});
    check('the owner fires an emergency', fired.status === 200, `HTTP ${fired.status}`);

    /*
      The release_state id is read from the cluster rather than guessed. The
      confirm route's path parameter IS that id — not the trigger's — and the
      token is scoped to it, so getting this wrong answers 403 with a message
      about scoping that would look like a permissions bug.
    */
    const releaseRow = await query<{ id: string; state: string }>(
      `SELECT rs.id, rs.state FROM release_state rs
         JOIN users u ON u.id = rs.owner_id
        WHERE u.email = $1 AND rs.trigger_type = 'emergency'
        ORDER BY rs.created_at DESC LIMIT 1`,
      [owner.email],
    );
    const releaseStateId = releaseRow.rows[0]?.id;
    if (!releaseStateId) throw new Error('no release_state row for the fired emergency');

    /*
      The verifier token is minted in-process rather than read out of an email,
      exactly as `e2e-ui.ts` mints a NextAuth session rather than typing a
      password into a form. The verifier's own SURFACE is proven by the
      2026-08-13 walk; what this walk exists to prove starts after the release
      opens, and routing round the notification keeps it from depending on mail
      that is deliberately undeliverable here.
    */
    const verifierToken = await issueVerifierToken(verifierId, releaseStateId);
    const confirmed = await contact.post(`/api/triggers/${releaseStateId}/confirm`, {
      verifier_token: verifierToken,
      method: 'email',
      decision: 'confirm',
    });
    const outcome = confirmed.body as { status?: string; received?: number; required?: number };
    /*
      ⚠️ HTTP 200 IS NOT AGREEMENT. `submitConfirmation` answers 200 with
      `not_counted` when the verifier is unconfirmed, `duplicate` when they have
      already answered and `inactive` outside a confirmable window — all of them
      successful requests that moved the tally nowhere. The first run of this
      walk asserted only the status code and reported "quorum is met" over a
      0/1 tally, which is the same shape of mistake the whole repo keeps finding:
      a green signal measuring something adjacent to the question.
    */
    check(
      'the verifier confirms and the tally actually advances',
      confirmed.status === 200 && outcome.status !== 'not_counted' && (outcome.received ?? 0) >= 1,
      `HTTP ${confirmed.status} ${outcome.status ?? ''} ${outcome.received ?? '?'}/${outcome.required ?? '?'}`,
    );

    /*
      ⚠️ QUORUM IS NOT RELEASE. `submitConfirmation` can answer `pending_grace`:
      the verifiers have agreed and the grace window is still running, which is
      the owner's last chance to stop it and is the whole reason emergencies are
      reversible. `resolveElapsedGrace` releases when the window and the quorum
      agree, and it runs from the heartbeat cron — not from this walk. So the
      state is READ rather than assumed, and a walk that stops here stops
      honestly instead of reporting a reveal failure that is really a grace
      window doing its job.
    */
    const after = await query<{ state: string }>(`SELECT state FROM release_state WHERE id = $1`, [
      releaseStateId,
    ]);
    const state = after.rows[0]?.state;
    check(
      'the release reaches RELEASED (not still in grace)',
      state === 'released',
      `state=${state}`,
    );
    if (state !== 'released') {
      console.log(
        '\n  STOPPING: the release is in grace, so Reveal is correctly refused and the\n' +
          '  round trip cannot be walked from here. That is the product working. Re-run\n' +
          '  after the heartbeat sweep, or configure a zero grace window for the walk.',
      );
      return;
    }

    // ---- THE MOMENT ------------------------------------------------------
    const plan = await contact.call('/api/access');
    check('the recipient opens a plan, not an error', plan.status === 200, `HTTP ${plan.status}`);

    const structuredPlain = await reveal(contact, structuredId);
    const revealed = decodeSecretPayload(structuredPlain);

    check(
      'Reveal returns the exact password the owner typed',
      valueOf(revealed, 'password') === SECRET.password,
      valueOf(revealed, 'password') === SECRET.password ? 'byte for byte' : 'MISMATCH',
    );
    check(
      'the username comes back as its own labelled field',
      valueOf(revealed, 'username') === SECRET.username,
      String(valueOf(revealed, 'username')),
    );
    check(
      'the secret is LABELLED FIELDS, not one opaque blob',
      revealed.length === 4 && new Set(revealed.map((f) => f.kind)).size === 4,
      revealed.map((f) => f.kind).join(', '),
    );
    check(
      'every recovery code survives the round trip',
      recoveryCodesOf(revealed).join(',') === SECRET.recoveryCodes.join(','),
      recoveryCodesOf(revealed).length + ' codes',
    );

    // ---- The six digits that are the difference between in and out --------
    const seed = valueOf(revealed, 'totp');
    const params = seed ? parseOtpauth(seed) : null;
    const now = Date.now();
    const shown = params ? await generateTotp(params, now) : null;
    const independent = params ? await generateTotp(parseOtpauth(SECRET.totp)!, now) : null;
    check(
      'the TOTP seed produces a live six-digit code',
      Boolean(shown && /^\d{6}$/.test(shown.code)),
      shown ? shown.code : 'none',
    );
    check(
      'and it matches a code computed independently from the same seed',
      Boolean(shown && independent && shown.code === independent.code),
      shown && independent ? `${shown.code} == ${independent.code}` : 'MISMATCH',
    );

    // ---- The legacy shape, which is what real stored items look like ------
    const legacyPlain = await reveal(contact, legacyId);
    const legacyFields = decodeSecretPayload(legacyPlain);
    check(
      'a legacy imported item decodes to labelled fields, NOT raw JSON',
      legacyFields.length === 2 &&
        valueOf(legacyFields, 'username') === 'legacy.user@example.test' &&
        valueOf(legacyFields, 'password') === 'imported-from-lastpass-2211',
      legacyFields.map((f) => f.kind).join(', '),
    );
    check(
      'and no field still contains a JSON brace',
      legacyFields.every((f) => !String(f.value).includes('{"')),
      'clean',
    );

    // ---- What is hidden, and what is not ---------------------------------
    check(
      'the password is marked for masking',
      MASKED_KINDS.has('password'),
      'masked until asked for',
    );
    check(
      'the TOTP code and recovery codes are NOT masked',
      !MASKED_KINDS.has('totp') && !MASKED_KINDS.has('recovery_codes'),
      'readable at a glance, which is the point of them',
    );
  } finally {
    console.log('');
    await closeContact(contact).catch((e) => console.log('  cleanup contact failed:', e.message));
    await closeContact(verifier).catch((e) => console.log('  cleanup verifier failed:', e.message));
    await closeOwner(owner).catch((e) => console.log('  cleanup owner failed:', e.message));
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
