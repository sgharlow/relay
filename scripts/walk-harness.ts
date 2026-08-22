/**
 * The parts every live walk needs, in one place instead of five.
 *
 * WHY THIS EXISTS. The five walks that shipped before 2026-08-21 each carry
 * their own copy of the cookie jar, the sign-up dance, the claim POST and the
 * `check()` printer — about 90 duplicated lines apiece. That was survivable at
 * five. The three walks added on 2026-08-21 for J3, J6 and J9 would have made it
 * eight, and a bug in the sign-in helper would then need finding eight times.
 *
 * ⚠️ **THE FIVE EXISTING WALKS ARE DELIBERATELY NOT REFACTORED ONTO THIS.** They
 * are the release gate's live half and they are green; rewriting working
 * verification to share a helper is the "improve the architecture that already
 * works" move this repo's own rules forbid. New walks use this; old walks keep
 * their copies until something independently needs to change in them.
 *
 * ⚠️ WRITES TO WHATEVER `E2E_BASE` POINTS AT, and `.env.local` points at the
 * PRODUCTION cluster — Relay has no dev database. Every actor lives on an
 * RFC 6761 reserved domain that can never receive mail, and `undeliverable()`
 * refuses anything else at construction time rather than at the mail seam.
 *
 * Feature: relay-h0-mvp
 * Requirements: D10 (the journey sweep is stale)
 */
import { generateTotpCodeFor } from '../lib/auth/totp';

export const BASE = process.env.E2E_BASE || 'http://localhost:3000';

/**
 * RFC 6761 reserved TLDs, which resolve nowhere and can never receive mail.
 *
 * A walk that used a real domain would send real invitations to a real inbox —
 * and `assertDeliverableDomain` at the mail seam refuses these, so a fixture
 * cannot generate a bounce on the shared ESP reputation. Kept as a hard throw
 * rather than a lint rule because it is a production write path.
 */
const RESERVED = ['test', 'invalid', 'localhost'];

export function undeliverable(address: string): string {
  if (!RESERVED.includes(address.split('.').pop() as string)) {
    throw new Error(`refusing to use ${address}: not a reserved, undeliverable domain`);
  }
  return address;
}

export interface CheckResult {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * A run's tally. Instantiated per walk rather than module-global so two walks
 * imported into one process cannot merge their results — the shape that makes
 * a failure land in the wrong report.
 */
export class Results {
  readonly all: CheckResult[] = [];

  check(step: string, ok: boolean, detail = ''): boolean {
    this.all.push({ step, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(66)} ${detail}`);
    return ok;
  }

  /** Prints the tally and sets a non-zero exit code if anything failed. */
  finish(): void {
    const failed = this.all.filter((r) => !r.ok);
    console.log(`\n${this.all.length - failed.length}/${this.all.length} checks passed`);
    if (failed.length) {
      console.log('\nFAILED:');
      for (const f of failed) console.log(`  - ${f.step} ${f.detail}`);
      process.exitCode = 1;
    }
  }
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/**
 * One signed-in person, with their own cookie jar.
 *
 * ⚠️ `redirect: 'manual'` throughout. NextAuth answers several of these with a
 * 302 carrying the Set-Cookie that matters; following it silently drops the
 * session and every later call reads as an authorization bug.
 */
export class Actor {
  readonly jar = new Map<string, string>();
  secret = '';

  constructor(
    readonly label: string,
    readonly email: string,
  ) {
    undeliverable(email);
  }

  private remember(res: Response): void {
    for (const [k, v] of res.headers) {
      if (k.toLowerCase() !== 'set-cookie') continue;
      // Split on commas that begin a new cookie pair, not on commas in Expires.
      for (const part of v.split(/,(?=[^;]+?=)/)) {
        const [pair] = part.trim().split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    }
  }

  async call(path: string, init: RequestInit = {}): Promise<Reply> {
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
      body = { _raw: text.slice(0, 300) };
    }
    return { status: res.status, body };
  }

  post(path: string, b: unknown): Promise<Reply> {
    return this.call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  }

  put(path: string, b: unknown): Promise<Reply> {
    return this.call(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  }

  patch(path: string, b: unknown): Promise<Reply> {
    return this.call(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  }

  del(path: string, b: unknown): Promise<Reply> {
    return this.call(path, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  }

  /** A fetch the CryptoService can use: relative paths, this actor's cookies. */
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

/** Enrol a brand-new owner account, TOTP and all. Throws on any non-happy path. */
export async function signUp(a: Actor): Promise<void> {
  const begin = await a.post('/api/auth/signup', { email: a.email, displayName: a.label });
  if (begin.status !== 201) {
    throw new Error(`${a.label} signup begin ${begin.status} ${JSON.stringify(begin.body)}`);
  }
  const url = new URL(String(begin.body.otpauthUrl).replace('otpauth://', 'https://'));
  const secret = url.searchParams.get('secret');
  if (!secret) throw new Error(`${a.label}: no TOTP secret in the otpauth URL`);
  a.secret = secret;

  const done = await a.call('/api/auth/signup', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enrolmentToken: begin.body.enrolmentToken,
      code: generateTotpCodeFor(secret),
    }),
  });
  if (done.status !== 200) {
    throw new Error(`${a.label} signup complete ${done.status} ${JSON.stringify(done.body)}`);
  }
}

export async function signIn(a: Actor): Promise<void> {
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

/** Redeem an invitation code into a standby account — the calm path, not a crisis. */
export async function claim(a: Actor, code: string): Promise<Reply> {
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

/** Elevate, then delete. Owners hold a TOTP secret; step-up is required to close. */
export async function closeOwner(a: Actor): Promise<void> {
  if (!a.secret) {
    console.log(`  cleanup: ${a.email} -> never created`);
    return;
  }
  await signIn(a);
  await a.post('/api/account/step-up', { totpCode: generateTotpCodeFor(a.secret) });
  const res = await a.del('/api/account', { confirmEmail: a.email });
  console.log(`  cleanup: ${a.email} -> HTTP ${res.status}`);
}

/**
 * A claimed standby contact holds a session and no TOTP secret, so there is
 * nothing to elevate with and the closure path is the plain one.
 */
export async function closeContact(a: Actor): Promise<void> {
  const res = await a.del('/api/account', { confirmEmail: a.email });
  console.log(`  cleanup: ${a.email} (contact) -> HTTP ${res.status}`);
}

/**
 * Run cleanup for everyone, never letting one failure skip the rest.
 *
 * 🔴 THE REASON THIS IS A HELPER. An early `e2e-multiowner` run left four
 * contacts behind because the first cleanup threw and the rest never ran — and
 * those rows are part of what `verify:orphans` has been counting ever since.
 * Cleanup is unconditional, individually caught, and prints every status.
 */
export async function closeAll(
  people: Array<{ actor: Actor; kind: 'owner' | 'contact' }>,
): Promise<void> {
  console.log('');
  for (const { actor, kind } of people) {
    try {
      if (kind === 'owner') await closeOwner(actor);
      else await closeContact(actor);
    } catch (e) {
      console.log(`  cleanup ${actor.email} FAILED: ${(e as Error).message}`);
    }
  }
}
