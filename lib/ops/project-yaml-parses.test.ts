/**
 * The authoritative machine-readable contract is actually machine-readable.
 *
 * 🔴 THE FINDING, CARRIED ACROSS THREE SPRINTS BEFORE IT WAS FIXED. `PROJECT.yaml`
 * opens by calling itself the *"machine-readable project contract. Single source
 * of truth for volatile facts and gates"* — and **nothing parsed it**. Every
 * check that reads it (`gates.test.ts`, `editorial-preflight-claims.test.ts`, and
 * `roadmap-lint`) does `readFileSync` and matches regexes, which succeeds
 * happily on a file YAML itself would reject.
 *
 * So a syntax error in the one file the rules name as the source of truth was
 * SILENT until something needed the broken part. And the failure mode is not
 * hypothetical for this file specifically: its entries are enormous
 * double-quoted multi-line strings, where a single unescaped `"` ends the scalar
 * early and turns the rest of an entry into structure. A regex reader would not
 * notice; it would just stop matching, and a guard that stops matching passes.
 *
 * ⚠️ THIS TEST ADDS A DEPENDENCY, and that is the interesting part of the
 * decision rather than a footnote. Node ships no YAML parser, so "parse it" is
 * unavailable without one. `js-yaml` was already in the tree transitively (via
 * eslint) but undeclared and untyped — depending on a package that arrives by
 * accident is how a build breaks when an unrelated dependency is upgraded. `yaml`
 * is declared, exact-pinned, self-typed, and dev-only: it cannot reach
 * production.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from 'yaml';

const PATH = join(process.cwd(), 'PROJECT.yaml');
const RAW = readFileSync(PATH, 'utf8');

describe('it parses', () => {
  it('is valid YAML', () => {
    /*
      parseDocument rather than parse, because it collects errors instead of
      throwing on the first — so a broken file reports everything wrong with it
      in one run rather than one problem per fix.
    */
    const doc = parseDocument(RAW);
    const errors = doc.errors.map((e) => `${e.name}: ${e.message}`);

    expect(
      errors,
      errors.length
        ? 'PROJECT.yaml is not valid YAML:\n' +
          errors.map((e) => `  ${e}`).join('\n') +
          '\n\nThis file calls itself the machine-readable contract and is the source of truth ' +
          'for gates and volatile facts. Every other check reads it with regexes, which pass ' +
          'happily on a file YAML rejects — so nothing else in the suite can tell you this.'
        : 'ok',
    ).toEqual([]);
  });

  it('reports warnings too, which are usually a duplicate key', () => {
    // A duplicate mapping key is legal-ish YAML and silently wins last, so a
    // second `due:` on a gate would quietly override the first.
    const doc = parseDocument(RAW);
    const warnings = doc.warnings.map((w) => w.message);
    expect(warnings, warnings.join('\n')).toEqual([]);
  });

  it('contains no tab characters, which YAML forbids for indentation', () => {
    const lines = RAW.split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^\s*\t/.test(line));
    expect(lines.map(([n]) => n), 'tabs at these lines').toEqual([]);
  });
});

/**
 * Parsed lazily, INSIDE each test, and never at module scope.
 *
 * ⚠️ The first version did `const doc = parse(RAW)` in the describe body. On a
 * file with a syntax error that throws during COLLECTION, so vitest reported
 * `no tests` — the suite went red with no indication of why, and the carefully
 * written "PROJECT.yaml is not valid YAML" message never ran. A guard whose
 * failure mode is "no tests" is barely better than the silence it replaces.
 *
 * Proven by planting an unescaped quote: with this shape the parse test reports
 * the error and the shape tests skip cleanly; with the old shape the whole file
 * vanished.
 */
function parsed(): Record<string, unknown> {
  try {
    return parse(RAW) as Record<string, unknown>;
  } catch (err) {
    expect.fail(
      `PROJECT.yaml does not parse, so its shape cannot be checked: ${String(err)}
` +
        'Fix the syntax error the "is valid YAML" test reports first.',
    );
  }
}

describe('the shape the regex readers depend on', () => {

  it('has the top-level keys the rules name', () => {
    const doc = parsed();
    for (const key of [
      'name',
      'ladder',
      'derived',
      'gates',
      'market',
      'monetization_path',
      'ratified',
      'journeys',
      'deferred',
    ]) {
      expect(doc, `PROJECT.yaml lost its \`${key}\` section`).toHaveProperty(key);
    }
  });

  it('gates, ratified and deferred are lists of things with ids', () => {
    const doc = parsed();
    for (const key of ['gates', 'ratified', 'deferred'] as const) {
      const list = doc[key];
      expect(Array.isArray(list), `${key} is not a list`).toBe(true);
      for (const entry of list as Array<Record<string, unknown>>) {
        expect(typeof entry.id, `an entry in ${key} has no id`).toBe('string');
      }
    }
  });

  it('every id is unique within its section', () => {
    /*
      Two entries with the same id is the drift this file exists to prevent,
      arriving from inside: a reader looking one up by id gets whichever the
      parser handed back, and the other becomes invisible.
    */
    const doc = parsed();
    for (const key of ['gates', 'ratified', 'deferred'] as const) {
      const ids = (doc[key] as Array<{ id: string }>).map((e) => e.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `duplicate ids in ${key}`).toEqual([]);
    }
  });

  it('derived carries commands rather than values, which is the whole rule', () => {
    // The volatile-numbers rule: this section holds the COMMAND that produces a
    // number, never the number. A bare value here would be the rule broken in
    // the file that states it.
    const derived = parsed().derived as Record<string, string>;
    for (const [key, value] of Object.entries(derived)) {
      expect(typeof value, `derived.${key} is not a string`).toBe('string');
      expect(
        /[a-z]/.test(value) && !/^\d+$/.test(value.trim()),
        `derived.${key} looks like a value rather than a command: ${value}`,
      ).toBe(true);
    }
  });
});

describe('the deferred register is legible to a machine, not just a reader', () => {
  const deferredItems = () => parsed().deferred as Array<Record<string, unknown>>;

  it('every open item has an owner', () => {
    const ownerless = deferredItems()
      .filter((e) => !('closed' in e))
      .filter((e) => typeof e.owner !== 'string')
      .map((e) => e.id);
    expect(ownerless, 'open deferred items with no owner').toEqual([]);
  });

  it('every open item says what would end it', () => {
    // An item with no ends_when is the "we should probably..." this register
    // exists to stop becoming permanent. `held` items carry resumes_when instead.
    const endless = deferredItems()
      .filter((e) => !('closed' in e))
      .filter((e) => !('ends_when' in e) && !('held' in e) && !('blocked_on' in e))
      .map((e) => e.id);
    expect(endless, 'open deferred items with no ends_when').toEqual([]);
  });
});
