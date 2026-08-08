/**
 * Tests for how the owner is named to everyone else.
 *
 * The precedence is the whole point: a name when there is one, the email when
 * there is not, and never anything invented. A family must not get "Margaret"
 * in one message and a raw address in the next.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';

import { formatOwnerLabel, UNKNOWN_OWNER_LABEL } from './owner-label';

describe('formatOwnerLabel', () => {
  it('prefers the display name', () => {
    expect(formatOwnerLabel('Margaret Chen', 'margaret@example.com')).toBe('Margaret Chen');
  });

  it('falls back to the email — existing owners have no name and must keep working', () => {
    expect(formatOwnerLabel(null, 'margaret@example.com')).toBe('margaret@example.com');
    expect(formatOwnerLabel(undefined, 'margaret@example.com')).toBe('margaret@example.com');
  });

  it.each(['', '   ', '\t\n'])('treats the whitespace-only name %j as absent', (name) => {
    expect(formatOwnerLabel(name, 'margaret@example.com')).toBe('margaret@example.com');
  });

  it('trims a padded name rather than emitting the padding into a subject line', () => {
    expect(formatOwnerLabel('  Margaret Chen  ', 'm@example.com')).toBe('Margaret Chen');
  });

  it('falls back again when there is no email either', () => {
    expect(formatOwnerLabel(null, null)).toBe(UNKNOWN_OWNER_LABEL);
    expect(formatOwnerLabel(undefined, '   ')).toBe(UNKNOWN_OWNER_LABEL);
  });

  it('NEVER invents a name from the email local part', () => {
    // "sgharlow+margaret" is not a person's name, and guessing one is worse
    // than showing the address.
    expect(formatOwnerLabel(null, 'sgharlow+margaret@gmail.com')).toBe('sgharlow+margaret@gmail.com');
  });
});
