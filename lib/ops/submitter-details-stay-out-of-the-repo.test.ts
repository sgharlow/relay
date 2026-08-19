/**
 * A home address and a personal phone number must never reach this repository.
 *
 * 🔴 THE FACT THAT MAKES THIS A GUARD RATHER THAN A PREFERENCE:
 * `github.com/sgharlow/relay` is **PUBLIC**. Anything committed here is published
 * and is permanent in the history — a later edit does not remove it, only a
 * history rewrite on a public repo does. caregiver.com requires *"name address
 * and current telephone number and email address with all submissions"*, so
 * those details now exist on this machine for a real reason. They exist in
 * `.relay-submitter.json`, which is gitignored, and every document names the
 * PATH rather than the values.
 *
 * ⚠️ A CONVENTION WAS ALREADY TRIED AND ALREADY FAILED HERE. The .gitignore in
 * this repo carries three separate comments recording files that labelled
 * themselves "not committed" and reached a commit anyway — a scratch probe that
 * carried a TOTP secret, and QA fixtures that `git add -A` plus a
 * `git checkout -- .` was enough to defeat. So this is a test, not a note.
 *
 * Two layers, because they fail in different places:
 *
 *   1. **Structural, runs everywhere including CI.** The file is gitignored and
 *      is not tracked. This catches the likeliest regression by far — somebody
 *      edits .gitignore, or force-adds the file — and it needs no secret to be
 *      present to do it.
 *   2. **Value scan, runs where the values exist** (the machine doing the
 *      submission, which is also the only machine where a careless `git add -A`
 *      could publish them). Every tracked file is read and every value is
 *      searched for. On a fresh clone or in CI there is nothing to scan, and the
 *      test says so rather than reporting a pass it did not earn.
 *
 * The corpus is `git ls-files` — literally "what is published" — and not a
 * filesystem walk, because a walk would have to re-implement .gitignore and
 * would then find the values in the very file that is allowed to hold them.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const SUBMITTER = '.relay-submitter.json';

/**
 * Fails loudly rather than skipping. A guard that quietly does nothing when its
 * tool is missing is the "green signal that was wrong" this repo keeps catching.
 */
function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Every value that must never appear in a tracked file, flattened out of the JSON. */
function secretValues(): string[] {
  if (!existsSync(SUBMITTER)) return [];
  const raw = JSON.parse(readFileSync(SUBMITTER, 'utf8')) as Record<string, unknown>;
  const out: string[] = [];

  /*
    🔴 WHAT IS SCANNED IS NARROWER THAN "THE CONTACT DETAILS", AND BOTH
    NARROWINGS ARE FINDINGS RATHER THAN CONVENIENCES. The first draft of this
    test scanned every value, and it went red twice on correct content:

      - `postal_code`, `state`, `country` — short codes that collide with
        ordinary text. A synthetic `00000` postal code matched TWELVE tracked
        files: the audit chain's `'0'.repeat(64)` genesis hash, in the schema
        docs and four auth test files. A guard that fires on the genesis hash
        is a guard somebody deletes.

      - `name` and `email` — ALREADY PUBLISHED, ON PURPOSE. The author's name is
        in LICENSE, in `lib/contact.ts` and on `src/app/about/page.tsx`; the
        email is the product's published contact address and appears in
        PROJECT.yaml and four other tracked files. Scanning for them would fail
        the build on the copyright line. They are not what committing this file
        would newly expose.

    What committing it WOULD newly expose is a home street address and a
    personal telephone number. Those two are the guard.
  */
  const NOT_IDENTIFYING = new Set([
    'supplied',
    'country',
    'state',
    'postal_code',
    'name',
    'email',
  ]);

  const visit = (v: unknown, key: string) => {
    if (key.startsWith('_') || NOT_IDENTIFYING.has(key)) return;
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) visit(inner, k);
    }
  };
  for (const [k, v] of Object.entries(raw)) visit(v, k);

  return out.filter((s) => s.length >= 6);
}

/** Where a value appears in the published corpus. Empty is the only passing answer. */
function scanTracked(needles: string[]): string[] {
  if (!needles.length) return [];
  const files = git('ls-files', '-z').split('\0').filter(Boolean);
  const hits: string[] = [];

  for (const file of files) {
    let body: string;
    try {
      body = readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable — a value cannot be pasted into one by accident
    }
    for (const needle of needles) {
      if (body.includes(needle)) hits.push(`${file} contains a submitter detail`);
    }
  }
  return hits;
}

describe('the submitter contact details stay out of a public repository', () => {
  it('.relay-submitter.json is gitignored', () => {
    let ignored = false;
    try {
      git('check-ignore', '-q', SUBMITTER);
      ignored = true;
    } catch {
      ignored = false;
    }

    expect(
      ignored,
      `${SUBMITTER} is NOT gitignored. This repository is PUBLIC, and that file holds a real ` +
        'home address and telephone number. Restore the .gitignore entry before doing anything ' +
        'else — a commit publishes them permanently, and an edit afterwards does not take them ' +
        'back.',
    ).toBe(true);
  });

  it('.relay-submitter.json is not tracked', () => {
    const tracked = git('ls-files', '--', SUBMITTER).trim();
    expect(
      tracked,
      `${SUBMITTER} is TRACKED. It must be removed from the index (git rm --cached ${SUBMITTER}) ` +
        'and, if it has already been pushed, treated as published: the values are in the history ' +
        'until that history is rewritten.',
    ).toBe('');
  });

  it('no tracked file contains any of the submitter details', () => {
    const needles = secretValues();

    if (!needles.length) {
      /*
        No file, nothing to scan. Said out loud rather than passed silently: on a
        fresh clone and in CI this check is inert, and a reader is entitled to
        know which of the two layers actually ran.
      */
      expect(existsSync(SUBMITTER), `${SUBMITTER} absent — value scan inert here, structural checks above still ran`).toBe(false);
      return;
    }

    expect(scanTracked(needles), 'A submitter detail has reached a tracked file. Remove it from the file and use the PATH instead — every doc references `.relay-submitter.json`, never the values.').toEqual([]);
  });

  /**
   * The positive control. Without it, the scan above passes on an empty needle
   * list, a bad path, or a `readFileSync` that silently returns nothing — and a
   * scanner that cannot find a value it was handed is not a guard.
   */
  it('the scanner finds a value that IS present in a tracked file', () => {
    const hits = scanTracked([SUBMITTER]); // this filename appears in .gitignore, which is tracked
    expect(hits.length, 'the scanner found nothing when handed a string that is definitely in a tracked file — it is not reading the corpus').toBeGreaterThan(0);
    expect(hits.some((h) => h.startsWith('.gitignore'))).toBe(true);
  });
});
