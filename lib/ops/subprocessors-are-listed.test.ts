/**
 * Every company that receives customer data is named on /privacy — derived from
 * what the codebase actually talks to, not from a list somebody maintains.
 *
 * 🔴 THE DEFECT THIS EXISTS FOR. The page listed AWS, Vercel, OpenAI and Resend
 * under "Who else is involved" and omitted **Stripe**, which processes the card
 * details of every paying customer. Live-mode Stripe had been charging since
 * 2026-08-08. Same class as the `og:description` that still sold estate after
 * estate was withdrawn: a factual defect on a page whose entire value is that
 * it is accurate.
 *
 * ⚠️ AND A HARDCODED FIVE-ITEM ASSERTION WOULD PASS THE DAY A SIXTH ARRIVES,
 * which is how the omission happened in the first place — the list was written
 * once, correctly, and the product grew. So this derives the obligation from
 * `package.json`: EVERY runtime dependency is either a service that receives
 * customer data (and must be named on the page) or is classified as one that
 * does not, WITH A REASON. Adding any dependency forces that decision, and
 * forgetting fails the suite rather than the reader.
 *
 * That is the same shape as `body-limit.ts`'s `ALLOWED_RAW` and
 * `step-up-guard.ts`'s classification: every allowlist entry argues for itself.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRIVACY = join(process.cwd(), 'src/app/privacy/page.tsx');
const PKG = join(process.cwd(), 'package.json');

/**
 * Dependencies that put customer data in somebody else's hands, and the name
 * the page must use for them.
 */
const SERVICES: Record<string, { name: string; receives: string }> = {
  '@aws-sdk/client-kms': {
    name: 'Amazon Web Services',
    receives: 'wraps and unwraps every data key; the CMK is the reason a vault is a vault',
  },
  '@aws-sdk/dsql-signer': {
    name: 'Amazon Web Services',
    receives: 'the database itself — every row the product stores',
  },
  '@vercel/analytics': {
    name: 'Vercel',
    receives: 'hosts the app, so it serves and can observe every request',
  },
  openai: {
    name: 'OpenAI',
    receives: 'item labels for the importance engine — metadata, never ciphertext',
  },
  resend: {
    name: 'Resend',
    receives: 'the address and content of every invitation, verifier link and alert',
  },
  stripe: {
    name: 'Stripe',
    receives: 'the payment details of every paying customer, and their subscription status',
  },
};

/**
 * Dependencies that receive nothing, because they run in our own process.
 *
 * Every entry argues for itself. "It is a library" is not a reason; the reason
 * has to say why no customer data leaves.
 */
const IN_PROCESS: Record<string, string> = {
  '@simplewebauthn/browser': 'runs in the visitor’s own browser; talks to no server but ours',
  '@simplewebauthn/server': 'verifies attestations locally; no network calls',
  jose: 'signs and verifies JWTs in process; no network calls',
  next: 'the framework the app is built from; the SERVICE it runs on is Vercel, listed above',
  'next-auth': 'session handling in process; the credentials providers are all ours',
  otplib: 'computes TOTP codes locally — RFC 6238 arithmetic, no network',
  pg: 'the Postgres wire driver; the SERVICE it dials is Aurora DSQL, listed under AWS',
  qrcode: 'renders an enrolment QR locally; the seed never leaves the process',
  react: 'the rendering library; no network of its own',
  'react-dom': 'the DOM renderer; no network of its own',
};

function dependencies(): string[] {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { dependencies: Record<string, string> };
  return Object.keys(pkg.dependencies);
}

/** The "Who else is involved" section, which is the disclosure that matters. */
function subprocessorSection(): string {
  const src = readFileSync(PRIVACY, 'utf8');
  const start = src.indexOf('Who else is involved');
  expect(start, 'the subprocessor section is gone from /privacy').toBeGreaterThan(-1);
  const end = src.indexOf('</section>', start);
  return src.slice(start, end > -1 ? end : src.length);
}

/**
 * Named as its own list entry, not merely mentioned.
 *
 * 🔴 THIS FUNCTION EXISTS BECAUSE THE FIRST VERSION PASSED ITS OWN PLANT. It
 * asserted `section.toContain(name)`, and the plant renamed `<strong>Stripe</strong>`
 * to `<strong>NotStripe</strong>` — which still CONTAINS "Stripe", so the check
 * stayed green on a page that no longer named the processor. A substring match
 * on a company name is not a check that the company is listed; it is a check
 * that those letters appear somewhere.
 *
 * The repo has three recorded instances of a guard passing on the very defect it
 * was written for. This was nearly a fourth, caught only because the plant was
 * run rather than assumed.
 */
function namesAsListItem(section: string, name: string): boolean {
  return new RegExp(`<strong>${name}</strong>`).test(section);
}

describe('every service that receives customer data is named', () => {
  const section = subprocessorSection();

  it.each(Object.entries(SERVICES))('%s → the page names %s', (_pkg, { name }) => {
    expect(
      namesAsListItem(section, name),
      `/privacy does not name ${name} as an entry in "Who else is involved"`,
    ).toBe(true);
  });

  it('names Stripe specifically, which is the omission this file was written for', () => {
    expect(namesAsListItem(section, 'Stripe')).toBe(true);
    // And is not satisfied by an adjacent word that merely contains it.
    expect(namesAsListItem('<strong>NotStripe</strong>', 'Stripe')).toBe(false);
  });
});

describe('a new dependency cannot slip past the disclosure', () => {
  it('every runtime dependency is either a named service or classified as in-process', () => {
    const unclassified = dependencies().filter(
      (d) => SERVICES[d] === undefined && IN_PROCESS[d] === undefined,
    );

    expect(
      unclassified,
      unclassified.length
        ? 'These dependencies are neither listed as services on /privacy nor classified as ' +
          'in-process:\n' +
          unclassified.map((d) => `  ${d}`).join('\n') +
          '\n\nDecide which they are. If a dependency puts customer data in somebody else’s ' +
          'hands, it belongs on /privacy under "Who else is involved" BEFORE it ships — that ' +
          'page is a factual claim, and Stripe was missing from it for twelve days while ' +
          'live-mode billing charged real cards.'
        : 'ok',
    ).toEqual([]);
  });

  it('every in-process classification gives a real reason', () => {
    // A justification that cannot be falsified is decoration — the same bar
    // body-limit.ts sets on its own allowlist.
    for (const [dep, reason] of Object.entries(IN_PROCESS)) {
      expect(reason.length, `${dep}'s reason is too short to be one`).toBeGreaterThan(30);
    }
  });

  it('no dependency is classified twice, which would hide one of the two answers', () => {
    const both = Object.keys(SERVICES).filter((d) => IN_PROCESS[d] !== undefined);
    expect(both).toEqual([]);
  });
});

describe('the page tells the truth about what we CAN read', () => {
  const src = readFileSync(PRIVACY, 'utf8');

  /*
    🔴 THE SECOND DEFECT, found on 2026-08-20 while checking the page against the
    code rather than against itself. `users.totp_secret` is plaintext TEXT
    (migration 003) and is NOT wrapped by the CMK — so the owner's own sign-in
    authenticator IS readable from the database, while the page's list of what
    we can read did not mention it and the section above it said "neither can
    anyone who obtains our database". True of vault contents; materially
    incomplete as a whole.
  */
  it('discloses that the sign-in authenticator secret is stored readably', () => {
    expect(src).toMatch(/authenticator/i);
    expect(src).toContain('readable form');
  });

  it('still says the vault contents are not readable, because that part is true', () => {
    expect(src).toContain('We cannot decrypt your secrets');
  });
});
