/**
 * An empty box must not quietly delete the name people recognise.
 *
 * 🔴 THE FIELD LOADS EMPTY AND SAVING IT CLEARED THE NAME. `AccountClient` starts
 * `name` at `''` and nothing fetches the current display name, so "Your name"
 * always rendered blank with a placeholder in it. Pressing Save then PATCHed the
 * empty string and reported "Saved: (cleared — your email will be used)". An
 * owner who set a name at signup could destroy it in one click without ever
 * being shown what they were replacing.
 *
 * The section's own copy explains why that costs something: the name is "how you
 * appear to the people you trust… on every message Relay sends on your behalf —
 * including the one that arrives when something has gone wrong, which is the
 * worst possible moment for it to say an email address they do not recognise."
 * SignUpForm calls a missing name "the strongest phishing signal in the outbound
 * mail". Clearing it is a real loss, so it has to be asked for.
 *
 * ⚠️ PREFILLING IS THE OTHER HALF AND IS NOT DONE HERE. It needs the current name
 * from somewhere: there is no `GET /api/account`, and the NextAuth session
 * callback puts `ownerId`, `isDemo` and `sessionEpoch` on the session but not
 * `display_name`. Both of those live outside this screen. The guard goes where
 * the mistake happens; the empty box is still a gap.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { nameSaveIntent } from './name-intent';

describe('nameSaveIntent', () => {
  it('saves a name outright', () => {
    expect(nameSaveIntent('Margaret Chen', false)).toBe('save');
  });

  it('asks first when the box is empty', () => {
    // The unconfirmed empty save is the whole defect: it read as "save nothing"
    // and meant "delete the name you cannot currently see".
    expect(nameSaveIntent('', false)).toBe('confirm-clear');
  });

  it('treats whitespace as empty — a space is not a name', () => {
    expect(nameSaveIntent('   ', false)).toBe('confirm-clear');
  });

  it('clears once the owner has confirmed', () => {
    // Clearing stays possible. Somebody who wants their email used instead is
    // entitled to that; they are asked, not blocked.
    expect(nameSaveIntent('', true)).toBe('clear');
  });

  it('a confirmation does not leak into a non-empty save', () => {
    /*
      The subtle one. If the flag survived into the next submit, an owner who
      pressed Save on an empty box, changed their mind and typed a name would
      have that treated as a clear.
    */
    expect(nameSaveIntent('Margaret Chen', true)).toBe('save');
  });
});

describe('the account screen actually uses it', () => {
  /*
    ⚠️ THE HALF THAT IS EASY TO GET WRONG. A correct decision function nothing
    calls is the "guard that lives in a helper" failure this repo has a whole
    directory of checks about. Asserted against the screen's source, because the
    component needs a session and a fetch to render.
  */
  const client = () =>
    readFileSync('src/app/(owner)/account/AccountClient.tsx', 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

  it('routes the save through nameSaveIntent', () => {
    expect(client(), 'AccountClient should ask nameSaveIntent what to do').toMatch(
      /nameSaveIntent\(/,
    );
  });

  it('does not PATCH before the intent is resolved', () => {
    // The order is the guard: deciding after the request has gone is not a guard.
    const src = client();
    const decides = src.indexOf('nameSaveIntent(');
    const patches = src.indexOf("method: 'PATCH'");
    expect(decides, 'nameSaveIntent is not called at all').toBeGreaterThan(-1);
    expect(patches, 'the PATCH must come after the decision').toBeGreaterThan(decides);
  });
});
