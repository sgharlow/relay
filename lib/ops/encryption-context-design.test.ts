/**
 * The design's premises are facts about this codebase, and facts drift.
 *
 * `docs/encryption-context-design.md` (S4-1) settles how wrapped data keys will
 * be bound to an `EncryptionContext`. It is DESIGN ONLY — no crypto code has
 * changed — and its conclusions rest on four things that are true of the code
 * today. If any of them stops being true before the change is built, the design
 * is quietly wrong and the person implementing it will not know.
 *
 * 🔴 THE ONE THAT MATTERS MOST is the ordering premise: the wrap happens BEFORE
 * the item exists, which is why the context is `{ owner_id }` and not
 * `{ item_id }`. If somebody later changes the flow so the id is allocated
 * first, `{ item_id }` becomes available and becomes the better answer — and
 * this test going red is how that gets noticed rather than the design being
 * followed out of habit.
 *
 * ⚠️ THIS IS NOT A TEST OF THE CHANGE. There is nothing to test yet. It is a
 * test that the design still describes the repository it was written against.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.2, 2.4, 17.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const DESIGN = read('docs/encryption-context-design.md');

describe('premise 1 — the wrap happens before the item exists', () => {
  /**
   * The function's real extent, by brace matching.
   *
   * ⚠️ The first version of this test took a fixed 4000-character slice and went
   * red — on code PAST the end of the function, which does mention an item id.
   * A window that overshoots its subject asserts something about whatever
   * happens to follow it, which is a false negative here and would be a false
   * POSITIVE in an absence check somewhere else.
   */
  function functionBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start, `${signature} is gone`).toBeGreaterThan(-1);

    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces after ${signature}`);
  }

  it('encryptForUpload requests the key before anything is persisted', () => {
    const svc = stripComments(read('lib/crypto/crypto-service.ts'));
    const fn = functionBody(svc, 'async encryptForUpload');

    // It asks KMS for a key...
    expect(fn).toContain('/api/kms/wrap');
    // ...and never sees an item id, because the item does not exist yet. It
    // returns a PAYLOAD; the caller persists it and the id is allocated then.
    expect(fn).not.toMatch(/\bitem_?[Ii]d\b/);
  });

  it('the design says so, and says what would change if it stopped being true', () => {
    expect(DESIGN).toMatch(/wrap happens before the item exists/i);
    expect(DESIGN).toContain('owner_id');
  });
});

describe('premise 2 — both unwrap paths already hold the owner id', () => {
  it('the owner branch loads the row by (id, owner_id)', () => {
    const route = stripComments(read('src/app/api/kms/unwrap/route.ts'));
    expect(route).toMatch(/FROM vault_items WHERE id = \$1 AND owner_id = \$2/);
  });

  it('the recipient branch gets ownerId back from the gate', () => {
    // If this stops returning ownerId, the recipient path needs a new query and
    // the design's "no new query" claim is false.
    const gate = stripComments(read('lib/kms/unwrap-gate.ts'));
    expect(gate).toMatch(/ownerId/);

    const route = stripComments(read('src/app/api/kms/unwrap/route.ts'));
    expect(route).toMatch(/\{\s*allowed,\s*ownerId\s*\}\s*=\s*await evaluateRecipientUnwrap/);
  });
});

describe('premise 3 — the call sites the design enumerates are the call sites there are', () => {
  /*
    The design lists one wrap and three unwraps. A fifth appearing later would
    be a path nobody taught to pass a context — which fails closed (KMS refuses)
    rather than open, but fails at runtime on a customer's reveal.
  */
  it('exactly one place generates a data key', () => {
    const callers = ['src/app/api/kms/wrap/route.ts'];
    for (const f of callers) expect(stripComments(read(f))).toContain('generateDataKey(');

    // and nothing else does
    const others = ['lib/access/dashboard.ts', 'src/app/api/kms/unwrap/route.ts'];
    for (const f of others) expect(stripComments(read(f))).not.toContain('generateDataKey(');
  });

  it('exactly three places decrypt one', () => {
    const sites = [
      'src/app/api/kms/unwrap/route.ts',
      'lib/access/dashboard.ts',
    ];
    for (const f of sites) expect(stripComments(read(f))).toContain('decryptDataKey(');

    // The route holds two of the three (owner branch and recipient branch).
    const route = stripComments(read('src/app/api/kms/unwrap/route.ts'));
    expect((route.match(/decryptDataKey\(/g) ?? []).length).toBe(2);
  });
});

describe('premise 4 — nothing has started implementing this yet', () => {
  /*
    The sprint is gated to design only. If a later change adds an
    EncryptionContext without the marker column and the no-fallback rule, it has
    the self-defeating shape §2 of the design describes: a decrypt that falls
    back to no context is a permanently available bypass.

    This does not forbid the change. It requires the migration to land with it.
  */
  it('if a context is ever passed, the era marker must exist too', () => {
    const client = stripComments(read('lib/kms/kms-client.ts'));
    const usesContext = client.includes('EncryptionContext');

    if (!usesContext) {
      expect(usesContext, 'design only — nothing implemented yet, as gated').toBe(false);
      return;
    }

    /*
      Read across ALL migrations rather than one filename, and never let a
      missing file throw. The first version called readFileSync on a fixed path
      and the plant failed with a bare `ENOENT` — a guard whose failure message
      is a file-not-found teaches the reader nothing about what they broke.
    */
    const dir = join(process.cwd(), 'db/migrations');
    const declared = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');

    expect(
      declared.includes('kms_context_era'),
      'An EncryptionContext is now passed to KMS, and NO migration declares the era marker.\n\n' +
        'Without it the unwrap path cannot know which rows are legacy, so the only way to ' +
        'handle a pre-change blob becomes a decrypt that falls back to no context — which is a ' +
        'permanently available bypass, reachable by anyone who can make the first attempt fail. ' +
        'That is the self-defeating shape docs/encryption-context-design.md §2 exists to prevent.\n\n' +
        'Land the migration with the change, not after it.',
    ).toBe(true);
  });
});

describe('the design records the trap rather than only the plan', () => {
  it('names the fallback as the thing that must not be built', () => {
    expect(DESIGN).toMatch(/re-opens the exact hole/i);
    expect(DESIGN).toMatch(/never inferred from a failure/i);
  });

  it('specifies the two assertions a hurried implementation drops', () => {
    expect(DESIGN).toMatch(/refused BY KMS/);
    expect(DESIGN).toMatch(/There is no fallback/);
  });
});
