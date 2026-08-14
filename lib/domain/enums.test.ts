/**
 * Pins the split between what the DOMAIN supports and what a USER may select.
 *
 * Why this file exists: /rules rendered its dropdown straight from
 * VALID_TRIGGER_TYPES, so the product offered `estate` — a permanent,
 * irreversible handoff — while src/app/terms/page.tsx said it was not offered.
 * One list was answering two different questions.
 *
 * ⚠️ THE EXCLUSION IS NOW PERMANENT. Gate g2-counsel-opinion was DECLINED on
 * 2026-08-14, not met: no opinion is being sought, so the condition that would
 * have re-opened estate can never be satisfied. This file no longer guards a
 * temporary state — it guards a decision.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import {
  VALID_TRIGGER_TYPES,
  USER_SELECTABLE_TRIGGER_TYPES,
  isUserSelectableTriggerType,
} from './enums';

describe('user-selectable trigger types (estate withdrawn permanently)', () => {
  it('does NOT offer estate, which the Terms and PROJECT.yaml both say is withdrawn', () => {
    expect(USER_SELECTABLE_TRIGGER_TYPES).not.toContain('estate');
    expect(isUserSelectableTriggerType('estate')).toBe(false);
  });

  it('still supports estate at the DOMAIN level — the release machinery depends on it', () => {
    // The state machine, heartbeat blocking and grace windows all handle
    // 'estate'. Removing it from the domain would break existing rows and
    // Property 7; this gate is about what a user may CREATE, nothing else.
    expect(VALID_TRIGGER_TYPES).toContain('estate');
  });

  it('offers every other domain trigger type, so the gate cannot silently widen', () => {
    for (const t of VALID_TRIGGER_TYPES) {
      if (t === 'estate') continue;
      expect(USER_SELECTABLE_TRIGGER_TYPES).toContain(t);
    }
  });

  it('rejects values that are not trigger types at all', () => {
    for (const bogus of ['apocalypse', '', 'ESTATE', null, undefined, 7, {}]) {
      expect(isUserSelectableTriggerType(bogus)).toBe(false);
    }
  });

  it('accepts each selectable type', () => {
    for (const t of USER_SELECTABLE_TRIGGER_TYPES) {
      expect(isUserSelectableTriggerType(t)).toBe(true);
    }
  });
});
