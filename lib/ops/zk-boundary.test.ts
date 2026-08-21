/**
 * The zero-knowledge boundary, and the half of it that was never real.
 *
 * 🔴 THE FINDING. Requirements 11.5 and 17.4 name two mechanisms keeping the AI
 * agents away from vault contents: an IAM Deny, and a query-layer projection.
 * `docs/aws-setup.md` states that the Deny "ensures that any role matching
 * `relay-ai-intake*` cannot call `kms:Decrypt` … enforcing the ZK boundary for
 * the Intake Agent (Requirement 11.5)". It does not, and it never has. Nothing
 * in this repo assumes a role — no `AssumeRole`, no `fromTemporaryCredentials`,
 * no `STSClient` — so the statement's `aws:PrincipalArn` condition can never
 * match. `runIntake()` is called in process, under the single runtime
 * principal, from two route handlers.
 *
 * The structural half of the requirement was satisfied on paper by a condition
 * that cannot be true, and the mechanism actually holding the line was the one
 * the requirement lists second: a SELECT projection in
 * `lib/ai/metadata-query.ts`, described in its own header as "the ONLY data
 * accessor permitted inside AI route handlers". A convention — enforced by
 * everyone remembering.
 *
 * THIS FILE IS THE STRUCTURAL VERSION OF THAT CONVENTION, which is cheap today
 * and does not need a second AWS principal: no SQL anywhere under `lib/ai/` may
 * name a secret column. Four of the six modules there import `query` directly,
 * so the projection module being careful was never the whole story.
 *
 * ⚠️ WHAT THIS DOES NOT DO. It does not make the IAM Deny work, and it is not a
 * substitute for running the intake path under its own principal. That is new
 * capability held behind demand. What is obliged, and separate, is that the docs
 * stop describing the inert statement as protection — `infra/README.md` records
 * the true position and names the two documents that need correcting.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.5, 17.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/** The three columns that are the vault. Everything else is metadata. */
const SECRET_COLUMNS = ['ciphertext', 'wrapped_data_key', 'kms_key_id'];

/**
 * Only executable text speaks for the file. `metadata-query.ts` names all three
 * columns in a comment explaining that it excludes them — the same trap that has
 * caught four negative greps in this repo already.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

const aiModules = readdirSync('lib/ai')
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [`lib/ai/${f}`, codeOnly(readFileSync(`lib/ai/${f}`, 'utf8'))] as const);

describe('no AI module can name a secret column', () => {
  it('finds the AI modules at all, so this suite is not vacuous', () => {
    expect(aiModules.length).toBeGreaterThanOrEqual(5);
  });

  it.each(SECRET_COLUMNS)('%s appears in no executable line under lib/ai', (column) => {
    const offenders = aiModules
      .filter(([, src]) => new RegExp(`\\b${column}\\b`).test(src))
      .map(([name]) => name);

    expect(
      offenders,
      offenders.length
        ? `${column} is named in executable code under lib/ai:\n` +
          offenders.map((o) => `  ${o}`).join('\n') +
          '\n\nEverything under lib/ai runs with an LLM downstream of it. The IAM Deny that ' +
          'was supposed to make this impossible matches no principal that exists (see ' +
          'infra/README.md), so this check is the boundary. Read vault rows through ' +
          'getVaultMetadata() in lib/ai/metadata-query.ts, which projects non-secret columns ' +
          'only.'
        : 'ok',
    ).toEqual([]);
  });
});

describe('the inert IAM Deny is recorded as inert', () => {
  const policy = readFileSync('infra/iam-policy.json', 'utf8');
  const readme = readFileSync('infra/README.md', 'utf8');

  it('every statement in the policy is explained in infra/README.md', () => {
    const sids = [...policy.matchAll(/"Sid":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(sids.length, 'the policy has no Sids to check').toBeGreaterThanOrEqual(3);
    const unexplained = sids.filter((s) => !readme.includes(s));
    expect(
      unexplained,
      `These IAM statements have no account of them in infra/README.md: ${unexplained.join(', ')}. ` +
        'A policy document cannot carry comments, which is exactly why a statement that means ' +
        'something other than its Sid suggests can sit there for months being counted as ' +
        'protection.',
    ).toEqual([]);
  });

  /*
    THE CLAIM THAT INVALIDATES ITSELF. "The Deny is inert" is true only while
    nothing assumes a role. The day something does, the statement stops being
    decoration and starts being load-bearing — and every word written about it
    here and in infra/README.md needs re-reading. So this fails on the change
    rather than waiting to be noticed.
  */
  it('nothing has started assuming a role, which is what makes the Deny inert', () => {
    const dirs = ['lib', 'src', 'scripts'];
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const p = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) {
          if (/\b(AssumeRole|fromTemporaryCredentials|STSClient)\b/.test(codeOnly(readFileSync(p, 'utf8')))) {
            found.push(p);
          }
        }
      }
    };
    for (const d of dirs) walk(d);

    expect(
      found,
      found.length
        ? 'Something now assumes an IAM role:\n' +
          found.map((f) => `  ${f}`).join('\n') +
          '\n\nThat changes the answer. infra/iam-policy.json\'s DenyKmsDecryptForAiRoles has ' +
          'been inert precisely because no role principal existed to match it, and both ' +
          'infra/README.md and this test say so. Re-read them: if the new role is the AI ' +
          'intake path, the Deny is now load-bearing and Requirement 11.5\'s structural half ' +
          'is real for the first time — which is a good outcome that must be verified, not ' +
          'assumed.'
        : 'ok',
    ).toEqual([]);
  });
});
