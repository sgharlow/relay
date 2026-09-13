import { describe, it, expect } from 'vitest';

import { labelForAction, LABELS } from './action-labels';
import { RELEASE_NOTICE_UNDELIVERED_ACTION } from '../notify/notifications';

describe('labelForAction', () => {
  it('turns the undelivered-release action into a sentence', () => {
    expect(labelForAction(RELEASE_NOTICE_UNDELIVERED_ACTION)).toBe(
      'A release notice could not be delivered to a recipient',
    );
  });

  it('never hides an unknown action — it comes back unchanged', () => {
    expect(labelForAction('something_new')).toBe('something_new');
    expect(labelForAction('')).toBe('');
  });

  it('gives the retired estate action a neutral, past-tense sentence (GP-U13)', () => {
    const label = LABELS.estate_irreversibility_acknowledged!;
    expect(label).toMatch(/no longer offered/);
    expect(label).not.toMatch(/inherit|heir|will\b/i);
  });
});
