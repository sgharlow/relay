/**
 * Every handler that reads a request body has a ceiling on it.
 *
 * 🔴 SIXTEEN DID NOT, found by the pre-release audit on 2026-08-13 — the day
 * after `PROJECT.yaml` recorded `unbounded-request-body` as CLOSED. It was
 * closed for the twenty-six routes that call `readJson`, and open for every
 * route that called `req.json()` itself.
 *
 * THE LESSON IS ABOUT WHERE A GUARD LIVES. `read-json-limit.test.ts` is a good
 * test of a good helper, and it could never have caught this: it asserts what
 * `readJson` does when you call it, not that anybody does. A cap that lives in
 * a helper is a cap on the helper. This asserts the property the product
 * actually needs — that no route can read an unbounded body — which is why it
 * scans the filesystem instead of importing anything.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findUncappedBodyReads, ALLOWED_RAW, stripComments } from './body-limit';

describe('request bodies are bounded', () => {
  it('no route reads a body without a ceiling', () => {
    const uncapped = findUncappedBodyReads('.');
    expect(
      uncapped,
      uncapped.length
        ? 'These handlers read a request body without a bound:\n' +
          uncapped.map((u) => `  ${u.call.padEnd(16)} ${u.route}`).join('\n') +
          '\n\nUse readJson(req) — or readJsonOptional(req) if the body is ' +
          'genuinely optional and a missing one must still be accepted. Pass a ' +
          'larger maxBytes if this route legitimately carries more, the way ' +
          '/api/import and the vault routes do. If it truly must read the raw ' +
          'body, add it to ALLOWED_RAW in lib/ops/body-limit.ts with the reason.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    The allowlist has to stay arguable. An entry with no reason is a place to
    hide a route, which is what this whole check exists to prevent.
  */
  it('every allowlisted route carries a reason', () => {
    for (const [route, reason] of Object.entries(ALLOWED_RAW)) {
      expect(reason.length, `${route} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });

  it('allowlisted routes still exist', () => {
    for (const route of Object.keys(ALLOWED_RAW)) {
      const file = join('src/app', route.replace(/^\//, ''), 'route.ts');
      expect(() => readFileSync(file, 'utf8'), `${route} is allowlisted but gone`).not.toThrow();
    }
  });

  /*
    🔴 THE CHECK MUST BE ABLE TO FAIL. A scanner that returns an empty array
    because its regex never matches anything looks exactly like a clean
    codebase, and this repo has already been bitten by a guard that passed on
    the very defect it was written for (api-reachability.ts, the module-specifier
    false positive). So: plant a violation and watch it get caught.
  */
  it('catches an uncapped read when one is planted', () => {
    const root = join(tmpdir(), `relay-bodylimit-${process.pid}`);
    const dir = join(root, 'src/app/api/planted');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'route.ts'),
        'export async function POST(req) {\n  const body = await req.json();\n  return body;\n}\n',
      );
      const found = findUncappedBodyReads(root);
      expect(found).toEqual([{ route: '/api/planted', call: 'req.json()' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not report a call that only appears in a comment', () => {
    const src = stripComments(
      '/* this used to call req.json() directly */\n// and req.text() here too\nconst x = 1;\n',
    );
    expect(src).not.toContain('req.json()');
    expect(src).not.toContain('req.text()');
  });

  /*
    The two vault routes carry the largest legitimate payload in the product and
    take an override rather than the shared default. Pinned because the override
    is the part somebody would remove while "tidying up" the conversion.
  */
  it('the vault routes use the measured override, not the default', () => {
    for (const f of ['src/app/api/vault/items/route.ts', 'src/app/api/vault/items/[id]/route.ts']) {
      expect(readFileSync(f, 'utf8')).toMatch(/readJson\(req,\s*VAULT_MAX_JSON_BYTES\)/);
    }
  });
});
