/**
 * The owner-alias detector — §3.7 rules 5 and 7 made visible.
 *
 * Found 2026-09-01: the live owner's whole circle was plus-aliases of his own
 * address and every surface rendered it as two independent people. These tests
 * pin the classes that must be caught, the classes that must NOT be (a real
 * sibling on the same domain is not an alias), and — because a guard that
 * lives in a helper is a guard on the helper — that `beta:status` actually
 * consults it.
 *
 * Feature: relay-standby
 * Requirements: docs/standby-architecture.md §3.7 rules 5 and 7
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isOwnerAlias, OWNER_ALIAS_WARNING } from './owner-alias';

describe('isOwnerAlias', () => {
  it('catches a plus-alias of the owner', () => {
    expect(isOwnerAlias('steve@example.com', 'steve+ben@example.com')).toBe(true);
    expect(isOwnerAlias('steve+own@example.com', 'steve+april@example.com')).toBe(true);
  });

  it('catches the owner address itself, and case/whitespace variants', () => {
    expect(isOwnerAlias('steve@example.com', ' STEVE@Example.com ')).toBe(true);
  });

  it('catches gmail dot-variants, on gmail domains only', () => {
    expect(isOwnerAlias('sharlow@gmail.com', 's.harlow@gmail.com')).toBe(true);
    expect(isOwnerAlias('sharlow@googlemail.com', 's.har.low@googlemail.com')).toBe(true);
    // Dots are significant on ordinary domains — a guard that flags a real
    // person as fake is the false positive people learn to ignore.
    expect(isOwnerAlias('sharlow@example.com', 's.harlow@example.com')).toBe(false);
  });

  it('does NOT flag a genuinely different person', () => {
    expect(isOwnerAlias('steve@example.com', 'ben@example.com')).toBe(false);
    expect(isOwnerAlias('steve@example.com', 'steve@other.org')).toBe(false);
  });

  it('fails safe on malformed input — never throws, never flags', () => {
    expect(isOwnerAlias('', 'a@b.c')).toBe(false);
    expect(isOwnerAlias('a@b.c', 'not-an-email')).toBe(false);
    expect(isOwnerAlias('@nodomain', 'a@b.c')).toBe(false);
  });

  it('the warning names the rules and the consequence, without enumerating anything', () => {
    expect(OWNER_ALIAS_WARNING).toContain('§3.7');
    expect(OWNER_ALIAS_WARNING).toContain('self-signed');
    expect(OWNER_ALIAS_WARNING).not.toMatch(/\d+ (people|circles|owners)/);
  });
});

describe('the surfaces actually consult it', () => {
  it('beta:status imports and calls the detector', () => {
    // A guard that lives in a helper is a guard on the helper: this is the
    // sibling assertion that the one screen whose job is quorum truth uses it.
    const src = readFileSync('scripts/beta-status.ts', 'utf8');
    expect(src).toContain('isOwnerAlias');
    expect(src).toContain('OWNER_ALIAS_WARNING');
  });
});
