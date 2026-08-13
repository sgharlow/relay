/**
 * Tests for the one definition of "a" vs "an".
 *
 * The value here is the REGRESSION GUARD, not the logic: this defect shipped
 * three times in three files over five days, twice in one afternoon, because
 * each fix was a private copy that the next author did not know to look for.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { article, Article } from './article';
import { VALID_TRIGGER_TYPES } from '../rules/access-rules';

describe('article', () => {
  it.each(['emergency', 'estate'])('says "an" before the vowel-initial %s', (t) => {
    expect(article(t)).toBe('an');
    expect(Article(t)).toBe('An');
  });

  it.each(['caregiver', 'travel', 'business'])('says "a" before the consonant-initial %s', (t) => {
    expect(article(t)).toBe('a');
    expect(Article(t)).toBe('A');
  });

  it('handles every trigger type the product can produce', () => {
    // The list this defect keeps appearing in. If a sixth type is added, this
    // asserts it gets an answer rather than a crash.
    for (const t of VALID_TRIGGER_TYPES) {
      expect(['a', 'an']).toContain(article(t));
    }
  });

  it('is case-insensitive, so an already-capitalised word is not mis-read', () => {
    expect(article('Emergency')).toBe('an');
    expect(article('Travel')).toBe('a');
  });
});

describe('🔴 nobody re-implements this', () => {
  it('is the only definition in the codebase', async () => {
    // Three copies existed. Each new site copied the fix instead of importing
    // it, which made the next occurrence certain rather than unlikely.
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !full.includes(join('lib', 'text'))) {
          const src = readFileSync(full, 'utf8');
          if (/function\s+article\s*\(/.test(src)) hits.push(full);
        }
      }
    };
    walk(join(process.cwd(), 'lib'));
    walk(join(process.cwd(), 'src'));

    expect(hits).toEqual([]);
  });
});
