/**
 * The database connection verifies the server's certificate.
 *
 * 🔴 IT DID NOT, UNTIL 2026-08-13. `lib/db/connection.ts` hardcoded
 * `ssl: { rejectUnauthorized: false }` on both pools, so the connection
 * carrying every ciphertext, wrapped data key, IAM auth token and audit-chain
 * hash from Vercel to AWS would have accepted any certificate offered to it.
 *
 * WHY THIS IS A TEST AND NOT JUST A FIXED CONSTANT. The old value was a
 * constant too. What made it survive was that nothing anywhere asserted the
 * secure default, so flipping it back — for a local TLS annoyance, on a laptop,
 * at 11pm — would have been a one-character change that no reviewer and no
 * pipeline would have caught. This is the thing that notices.
 *
 * The escape hatch is tested as well as the default, because a rollback path
 * that has never been exercised is not a rollback path. `false` is how a
 * production incident gets closed in under a minute without a redeploy; it must
 * keep working, and it must keep requiring somebody to type the word.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sslRejectUnauthorized } from './connection';

const ENV = 'DSQL_SSL_REJECT_UNAUTHORIZED';

afterEach(() => {
  delete process.env[ENV];
});

describe('DSQL TLS certificate verification', () => {
  it('is ON when nothing is configured', () => {
    delete process.env[ENV];
    expect(
      sslRejectUnauthorized(),
      'An unconfigured environment must verify certificates. This is the ' +
        'production default and the whole point of the fix.',
    ).toBe(true);
  });

  /*
    Anything OTHER than the exact string "false" means on. A truthy-ish typo
    ("no", "0", "FALSE", an empty string from a blank Vercel variable) must not
    silently disable verification — the failure mode of a misread flag here is
    invisible, so the flag is deliberately hard to trip by accident.
  */
  it.each(['true', 'TRUE', '1', '0', 'no', 'False', 'FALSE', '', ' false '])(
    'stays ON for %o',
    (value) => {
      process.env[ENV] = value;
      expect(sslRejectUnauthorized()).toBe(true);
    },
  );

  it('is OFF only for the exact string "false" — the documented rollback', () => {
    process.env[ENV] = 'false';
    expect(sslRejectUnauthorized()).toBe(false);
  });

  /*
    THE OLD VALUE MUST NOT COME BACK BY ANOTHER ROUTE. Asserting the function
    is not enough: someone could reintroduce a literal in the pool config and
    leave this helper unused and still green. So the source is read.
  */
  it('has no hardcoded rejectUnauthorized literal left in the pool config', () => {
    const src = readFileSync('lib/db/connection.ts', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' ',
    );
    expect(
      /rejectUnauthorized\s*:\s*(false|true)\b/.test(src),
      'connection.ts contains a hardcoded rejectUnauthorized literal outside a ' +
        'comment. It must come from sslRejectUnauthorized() so the env override ' +
        'and this test both still apply.',
    ).toBe(false);
    expect(src).toMatch(/rejectUnauthorized:\s*sslRejectUnauthorized\(\)/);
  });

  /*
    The migration runner reached the correct answer first and documented it.
    The two must not drift apart again — one variable, one meaning, both sides
    of the repo.
  */
  it('uses the same variable name the migration runner already established', () => {
    expect(readFileSync('db/migrations/migrate.ts', 'utf8')).toContain(ENV);
  });
});
