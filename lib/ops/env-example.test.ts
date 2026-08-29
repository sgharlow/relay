/**
 * `.env.example` documents every environment variable the code reads.
 *
 * 🔴 IT DOCUMENTED TWELVE FEWER THAN THE CODE READ, found by the pre-release
 * audit on 2026-08-13 — including the whole DSQL connection set for the
 * migration runner, AUTH_SECRET, NEXT_PUBLIC_SITE_URL, and both alerting
 * addresses. Three of the omissions fail SILENTLY: an unset LEAD_NOTIFY_ADDRESS
 * records a caregiver lead and tells nobody, which is the input to the gate that
 * decides whether this product has a market.
 *
 * AND ONE WAS WORSE THAN AN OMISSION. This template said OPS_ALERT_EMAIL; the
 * code read OPS_ALERT_ADDRESS. Production had OPS_ALERT_EMAIL set, deliberately,
 * doing nothing — and the fallback to RESEND_REPLY_TO_ADDRESS meant alerts still
 * arrived, so nothing looked broken. A template that names a variable the code
 * ignores is worse than one that omits it: it produces confident
 * misconfiguration instead of a missing value somebody notices.
 *
 * The check is cheap — the audit found the drift with about four lines of
 * scripting — and the failure mode it prevents is a fresh environment that comes
 * up looking fine.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BACKSLASH = String.fromCharCode(92);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.split(BACKSLASH).join('/'));
  }
  return out;
}

/**
 * Provided by the platform or the toolchain, never by a person editing a
 * template. Documenting these would be noise that trains people to skim.
 */
const PROVIDED_BY_THE_PLATFORM = new Set([
  'NODE_ENV',
  'NEXT_RUNTIME',
  'VERCEL_ENV',
  'VERCEL_URL',
  'CI',
  'HOME',
  'USERPROFILE',
  'PATH',
  'PLAYWRIGHT_MODULE',
  // Set automatically on every Vercel build. Its LOCAL counterpart,
  // RELAY_BUILD_SHA, is a person's to set and IS documented in .env.example —
  // the pair is deliberately split across both lists rather than being treated
  // as one thing.
  'VERCEL_GIT_COMMIT_SHA',
]);

function variablesReadByCode(): Set<string> {
  const files = ['lib', 'src', 'scripts', 'db']
    .flatMap((d) => walk(d))
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.includes('.test.'));

  const found = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!PROVIDED_BY_THE_PLATFORM.has(m[1])) found.add(m[1]);
    }
  }
  return found;
}

/**
 * Documented, and read by something this scan cannot see. Each entry says what.
 *
 * This is the escape hatch for the "documented but never read" check, and it is
 * deliberately a place you have to write a sentence rather than a list you can
 * append to silently — that is the whole difference between this and the drift
 * it exists to catch.
 */
const CONSUMED_ELSEWHERE: Record<string, string> = {
  AWS_ACCESS_KEY_ID:
    'Read implicitly by the AWS SDK credential chain (KMS and the DSQL signer). ' +
    'No application code names it, and none should.',
  AWS_SECRET_ACCESS_KEY: 'Same as AWS_ACCESS_KEY_ID — the SDK credential chain reads it.',
  DSQL_CLUSTER_ARN:
    'Written by scripts/provision-dsql.sh and pushed to Vercel by scripts/go-live.sh. ' +
    'Shell, which this TypeScript scan does not read. The application never uses it.',
};

function variablesDocumented(): Set<string> {
  const out = new Set<string>();
  for (const line of readFileSync('.env.example', 'utf8').split(/\r?\n/)) {
    const m = /^\s*#?\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

describe('.env.example', () => {
  it('documents every variable the code reads', () => {
    const missing = [...variablesReadByCode()].filter((v) => !variablesDocumented().has(v)).sort();
    expect(
      missing,
      missing.length
        ? `These are read by code and absent from .env.example:\n  ${missing.join('\n  ')}\n\n` +
          'Add each one with a line saying what breaks when it is unset. If it is ' +
          'supplied by the platform rather than by a person, add it to ' +
          'PROVIDED_BY_THE_PLATFORM in this file instead.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    The other direction, which is the one that bit us. A documented name the
    code never reads gets set in production and does nothing.
  */
  it('names no variable the code never reads', () => {
    const read = variablesReadByCode();
    const stale = [...variablesDocumented()]
      .filter((v) => !read.has(v) && !CONSUMED_ELSEWHERE[v])
      .sort();
    expect(
      stale,
      stale.length
        ? `Documented in .env.example but read nowhere:\n  ${stale.join('\n  ')}\n\n` +
          'Either the code should read it, or the line should go. A template that ' +
          'names a variable the code ignores produces confident misconfiguration — ' +
          'OPS_ALERT_EMAIL was set in production for a day, doing nothing.'
        : 'ok',
    ).toEqual([]);
  });

  it('every "consumed elsewhere" entry says who consumes it, and is still documented', () => {
    const documented = variablesDocumented();
    for (const [name, reason] of Object.entries(CONSUMED_ELSEWHERE)) {
      expect(reason.length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(40);
      expect(documented.has(name), `${name} is allowlisted but no longer in .env.example`).toBe(
        true,
      );
    }
  });

  /*
    Named explicitly rather than left to the general check, because these three
    are the ones whose absence is invisible: nothing errors, nothing logs, and
    the first symptom is a message nobody received.
  */
  it.each(['LEAD_NOTIFY_ADDRESS', 'OPS_ALERT_ADDRESS', 'DSQL_SSL_REJECT_UNAUTHORIZED'])(
    'explains what silence means for %s',
    (name) => {
      const text = readFileSync('.env.example', 'utf8');
      const at = text.indexOf(`\n${name}=`);
      expect(at, `${name} must appear in .env.example`).toBeGreaterThan(-1);
      // The comment block immediately above it must say something substantive.
      const preceding = text.slice(Math.max(0, at - 700), at);
      expect(
        /#/.test(preceding) && preceding.split('#').length > 2,
        `${name} needs a comment explaining what happens when it is unset`,
      ).toBe(true);
    },
  );
});
