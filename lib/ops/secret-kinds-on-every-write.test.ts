/**
 * Every path that writes a vault-item ciphertext declares what the ciphertext
 * holds — structurally, not by each author remembering.
 *
 * 🔴 THE DEFECT THIS EXISTS FOR. Secret-types Phase 1 (035) added `secret_kinds`
 * and wired it on the CREATE path only. Import, update, and the two onboarding
 * flows all wrote a ciphertext with no declaration — and update was the worst,
 * because it re-encrypts in place and left the OLD declaration standing over a
 * NEW blob, so an item read `usable` on a factor it no longer held. The wiring
 * test that shipped with Phase 1 asserted the one path its author had just
 * written, which is exactly how the other four stayed invisible. A guard that
 * checks one call site is a guard on that call site.
 *
 * THE FIX HAS TWO STRUCTURAL HALVES, AND THIS ASSERTS BOTH:
 *
 *   1. DERIVE AT THE CHOKE POINT. `secret_kinds` describes the ciphertext, and
 *      exactly one function makes ciphertext — `CryptoService.encryptForUpload`.
 *      It derives the declaration there, from the plaintext it is about to
 *      encrypt, and ignores any caller value. So every write that goes through
 *      it is declared for free, and no call site can forget or disagree.
 *
 *   2. FAIL CLOSED AT THE BOUNDARY. The two persistence validators
 *      (`validateCreateInput`, `validateUpdateInput`) refuse a write that omits
 *      the declaration. A future path that hand-rolls a fetch instead of using
 *      the service fails loudly at the boundary rather than silently writing
 *      null.
 *
 * And it ENUMERATES the producers, so a sixth write path cannot be added blind:
 * any `src/` file that produces a persisted ciphertext must route through the
 * service and be listed below with a reason, or this fails.
 *
 * Conservative and textual, like its siblings in this directory: it errs toward
 * a missed alarm rather than a false one, and it asserts what must be PRESENT
 * rather than hunting for what must be absent, because a guard that greps for a
 * forbidden string matches the comment that explains the string.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13 (migration 035, secret types Phase 1)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(f, 'utf8');

/**
 * The ONLY functions that turn a plaintext secret into a persisted vault-item
 * payload. A file that produces a ciphertext calls one of these; there is no
 * other way to reach the write routes with a valid blob.
 */
const CIPHERTEXT_PRODUCERS = ['encryptForUpload', 'saveItem', 'updateItemSecret'];

/**
 * The `src/` files that produce a persisted vault-item ciphertext, each with the
 * reason it is safe — which, for every one, is that it goes through the service
 * that derives the declaration. This is the enumeration that makes a NEW path
 * fail the build: add a sixth producer and it is not in this map, so the test
 * below reports it until it is either routed through the service and listed, or
 * shown not to be a real producer.
 *
 * Every entry argues for itself, in the idiom of route-auth.ts's PUBLIC_ROUTES:
 * this is not a place to silence the check, it is a place to say why the path is
 * covered.
 */
const KNOWN_PRODUCERS: Record<string, string> = {
  'src/app/(owner)/vault/new/NewVaultItemClient.tsx':
    'The create form. Calls saveItem(encodeSecretPayload(fields), …); the ' +
    'declaration is derived inside encryptForUpload from that plaintext. Passes ' +
    'no secret_kinds itself — a caller value would be ignored.',
  'src/app/(owner)/vault/ItemControls.tsx':
    'The in-place edit (updateItemSecret) that re-encrypts an item. This is the ' +
    'path whose stale declaration was the worst half of the Phase-1 gap; going ' +
    'through the service means a re-encrypt re-derives.',
  'src/app/(owner)/import/ImportPageClient.tsx':
    'The CSV import. Encrypts every row with encryptForUpload before batching to ' +
    '/api/import, so each imported item declares what it holds — including a ' +
    'TOTP the export carried, which Phase 0 used to drop.',
  'src/app/(owner)/start/SeedWizard.tsx':
    'First-run onboarding. Calls encryptForUpload then POSTs to /api/vault/items ' +
    '— the same derivation as create, on a path Phase 1 had missed.',
  'src/app/(access)/helping/HelpingClient.tsx':
    'A helper entering an item into someone else’s vault (saveItem with an ' +
    'ownerId). Subject to the same crypto boundary as the owner, so the same ' +
    'derivation covers it.',
};

/** Walk src/ for .ts/.tsx, skipping tests. */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full.split('\\').join('/'));
    }
  }
  return out;
}

describe('secret_kinds is declared on every write, by construction', () => {
  it('the choke point derives it from the plaintext, in exactly one place', () => {
    /*
      One derivation, one home. If this appears anywhere else, the fact has two
      definitions that can drift — the very thing moving it to the choke point
      was meant to end.
    */
    const hits = [...sourceFiles(), ...sourceFiles('lib')].filter((f) =>
      /secretKindsOf\(\s*decodeSecretPayload\(/.test(read(f)),
    );
    expect(hits, `derivation should live only in the choke point; found in:\n  ${hits.join('\n  ')}`).toEqual([
      'lib/crypto/crypto-service.ts',
    ]);

    const svc = read('lib/crypto/crypto-service.ts');
    // Derived AFTER the metadata spread, so a caller value cannot win.
    expect(
      /\.\.\.metadata,[\s\S]{0,200}secret_kinds,/.test(svc),
      'secret_kinds must be set after `...metadata` so a caller cannot override the derived value',
    ).toBe(true);
  });

  it('both persistence validators fail closed on a missing declaration', () => {
    const vault = read('lib/vault/vault-items.ts');
    // The boundary function exists and throws on a non-string.
    expect(vault, 'requireSecretKinds is gone — the fail-closed boundary was removed').toMatch(
      /function requireSecretKinds\(/,
    );
    expect(
      /function requireSecretKinds\([\s\S]*?throw new ValidationError\(/.test(vault),
      'requireSecretKinds no longer throws — absence would be silently accepted',
    ).toBe(true);
    // Both validators route through it.
    const createUses = /validateCreateInput[\s\S]*?requireSecretKinds\(/.test(vault);
    const updateUses = /validateUpdateInput[\s\S]*?requireSecretKinds\(/.test(vault);
    expect(createUses, 'validateCreateInput does not call requireSecretKinds').toBe(true);
    expect(updateUses, 'validateUpdateInput does not call requireSecretKinds').toBe(true);
  });

  it('persistence carries it — create INSERTs it, update ASSIGNS it (not COALESCE)', () => {
    const vault = read('lib/vault/vault-items.ts');
    expect(vault, 'the create INSERT omits secret_kinds').toMatch(
      /INSERT INTO vault_items[\s\S]*?secret_kinds/,
    );
    /*
      The update must ASSIGN, never COALESCE. COALESCE would keep the old
      declaration when the blob changed — describing the new ciphertext with the
      old truth, which is the exact defect. Assert the assignment is present and
      is not a COALESCE.
    */
    const update = /UPDATE vault_items([\s\S]*?)RETURNING/.exec(vault)?.[1] ?? '';
    expect(update, 'the UPDATE does not set secret_kinds').toMatch(/secret_kinds\s*=/);
    expect(
      /secret_kinds\s*=\s*COALESCE/.test(update),
      'secret_kinds is COALESCE’d on update — a re-encrypt would keep the old, stale declaration',
    ).toBe(false);
  });

  it('every ciphertext producer in src/ is routed through the service and accounted for', () => {
    const producers = sourceFiles().filter((f) => {
      const src = read(f);
      return CIPHERTEXT_PRODUCERS.some((fn) =>
        new RegExp(`\\b${fn}\\s*\\(`).test(src),
      );
    });

    const unlisted = producers.filter((f) => !(f in KNOWN_PRODUCERS));
    expect(
      unlisted,
      unlisted.length
        ? 'These files produce a persisted vault-item ciphertext and are NOT in ' +
          'KNOWN_PRODUCERS. Because they go through CryptoService, the declaration ' +
          'is derived for them — but a new producer must be listed with the reason ' +
          'it is covered, so the enumeration stays honest and a hand-rolled write ' +
          'that skips the service is visible:\n  ' +
          unlisted.join('\n  ')
        : 'ok',
    ).toEqual([]);

    // And the list must not rot: a reason that names a file which no longer
    // produces ciphertext is a stale claim.
    const stale = Object.keys(KNOWN_PRODUCERS).filter((f) => !producers.includes(f));
    expect(
      stale,
      `KNOWN_PRODUCERS names files that no longer produce a ciphertext:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no call site passes secret_kinds — it is the service’s to derive, not the caller’s', () => {
    /*
      Passing it anywhere else is dead (encryptForUpload ignores it) AND
      misleading (it reads like the value that will be stored). The one file
      allowed to name it is the service itself.
    */
    const offenders = sourceFiles()
      .filter((f) => f !== 'lib/crypto/crypto-service.ts')
      .filter((f) => /secret_kinds:/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
    expect(
      offenders,
      offenders.length
        ? 'These pass secret_kinds to the write layer. It is derived at the choke ' +
          'point and any caller value is ignored — remove it:\n  ' +
          offenders.join('\n  ')
        : 'ok',
    ).toEqual([]);
  });
});
