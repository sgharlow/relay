/**
 * Tests for the passkey error taxonomy.
 *
 * The case that matters is `InvalidStateError`. It was proven to be a REAL path
 * against a CDP virtual authenticator on production 2026-08-12 — asking an
 * already-enrolled device to enrol again raises it, because the server sends
 * `excludeCredentials` — and the account page was reporting it as a device
 * failure. Someone who was already protected was told their device was broken.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { describe, it, expect } from 'vitest';

import { classifyPasskeyError } from './passkey-errors';

describe('classifyPasskeyError', () => {
  it('reads InvalidStateError as "already enrolled", not as a failure', () => {
    // The exact shape the browser throws when excludeCredentials matches.
    expect(classifyPasskeyError(new DOMException('exists', 'InvalidStateError'))).toBe('already');
  });

  it('treats a dismissed prompt as a decision, not an error', () => {
    expect(classifyPasskeyError(new DOMException('no', 'NotAllowedError'))).toBe('cancelled');
  });

  it('treats an aborted ceremony as cancelled', () => {
    expect(classifyPasskeyError(new DOMException('abort', 'AbortError'))).toBe('cancelled');
  });

  it('reports anything else as a genuine failure', () => {
    expect(classifyPasskeyError(new DOMException('boom', 'NotSupportedError'))).toBe('failed');
    expect(classifyPasskeyError(new Error('network'))).toBe('failed');
  });

  it('does not throw on junk — a classifier that crashes hides the real error', () => {
    expect(classifyPasskeyError(null)).toBe('failed');
    expect(classifyPasskeyError(undefined)).toBe('failed');
    expect(classifyPasskeyError('InvalidStateError')).toBe('failed');
    expect(classifyPasskeyError({ name: 42 })).toBe('failed');
  });
});
