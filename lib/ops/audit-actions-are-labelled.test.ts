/**
 * Every audit action the source emits has a sentence on /audit, and no sentence
 * is written for an action nothing emits — bound BOTH ways, the way
 * `verify-timeline-is-labelled.test.ts` binds the verifier's timeline.
 *
 * 🔴 WHY THE EMITTED SET IS DERIVED FROM THE SOURCE HERE AND NOT IMPORTED FROM
 * THE LABEL MODULE. The first draft of this task (gap plan revision 1, 2026-09-12)
 * defined `KNOWN_ACTIONS = Object.keys(LABELS)` and then asserted every known
 * action was labelled — a test that could not fail. A binding is only a binding
 * when the two sides come from different places. This side comes from reading
 * the code that writes audit rows.
 *
 * The scan is deliberately literal: `action: '<snake_case>'` at a write site,
 * `<NAME>_ACTION = '<snake_case>'` constants, the handful of ternary-chosen
 * actions and the `IntegrityAction` union listed by hand (a regex that tried to
 * be clever about ternaries was the second thing revision 1 got wrong), and the
 * `release_transition_${state}` template expanded over the release states.
 * If a new write site uses a shape this scan cannot see, the test still fails —
 * in the other direction, when its label lands here with nothing emitting it —
 * so the scan gets extended rather than the label dropped.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { LABELS } from '../audit/action-labels';

const ROOTS = ['lib', 'src'].map((d) => join(process.cwd(), d));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Actions chosen by a ternary or a union, which a regex over `action:` cannot see. */
const LISTED_BY_HAND = [
  'approval_granted',
  'approval_rejected',
  'standby_marked_break_glass_only',
  'standby_unmarked_break_glass_only',
  'standby_rejected',
  'standby_resigned',
  // IntegrityAction, lib/db/integrity.ts
  'ref_integrity_parent_not_found',
  'ref_integrity_owner_mismatch',
  'ref_integrity_cascade_delete',
  'ref_integrity_uniqueness_enforced',
];

const RELEASE_STATES = ['armed', 'pending', 'grace', 'released', 'cancelled'];

function emittedActions(): Set<string> {
  const found = new Set<string>(LISTED_BY_HAND);
  for (const file of ROOTS.flatMap((r) => sourceFiles(r))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/action: ['"]([a-z_]+)['"]/g)) found.add(m[1]!);
    for (const m of src.matchAll(/_ACTION = ['"]([a-z_]+)['"]/g)) found.add(m[1]!);
    if (src.includes('`release_transition_${')) {
      for (const s of RELEASE_STATES) found.add(`release_transition_${s}`);
    }
  }
  return found;
}

describe('every audit action the source emits has a sentence on /audit, and only those', () => {
  const emitted = emittedActions();

  it('found the write sites (a scan that finds nothing is a broken scan, not a clean one)', () => {
    expect(emitted.size).toBeGreaterThan(40);
    expect(emitted.has('vault_item_created')).toBe(true);
    expect(emitted.has('release_notice_undelivered')).toBe(true);
  });

  it('labels every emitted action', () => {
    const missing = [...emitted].filter((a) => !(a in LABELS)).sort();
    expect(missing, 'emitted actions with no sentence in lib/audit/action-labels.ts').toEqual([]);
  });

  it('has no sentence for an action nothing emits', () => {
    const orphans = Object.keys(LABELS).filter((a) => !emitted.has(a)).sort();
    expect(orphans, 'labels for actions no write site produces').toEqual([]);
  });

  it('every sentence is a sentence, not a restatement of the key', () => {
    for (const [action, label] of Object.entries(LABELS)) {
      expect(label, `${action} has no label`).toBeTruthy();
      expect(label.length, `${action}'s label is too short to be a sentence`).toBeGreaterThan(12);
      expect(label, `${action}'s label is the key itself`).not.toBe(action);
      expect(label, `${action}'s label leaks snake_case`).not.toMatch(/[a-z]_[a-z]/);
    }
  });
});
