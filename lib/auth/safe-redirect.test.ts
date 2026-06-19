/**
 * Tests for lib/auth/safe-redirect.ts
 *
 * Validates: Requirement 17.1 (no open redirects post-login)
 */

import { describe, it, expect } from 'vitest';
import { safeInternalPath } from './safe-redirect';

describe('safeInternalPath', () => {
  it('accepts a same-origin relative path', () => {
    expect(safeInternalPath('/recipients')).toBe('/recipients');
    expect(safeInternalPath('/vault/new?x=1')).toBe('/vault/new?x=1');
  });

  it('falls back for absolute and protocol-relative URLs', () => {
    expect(safeInternalPath('https://evil.com')).toBe('/vault');
    expect(safeInternalPath('//evil.com')).toBe('/vault');
    expect(safeInternalPath('/\\evil.com')).toBe('/vault');
  });

  it('falls back for missing/empty input', () => {
    expect(safeInternalPath(null)).toBe('/vault');
    expect(safeInternalPath(undefined)).toBe('/vault');
    expect(safeInternalPath('')).toBe('/vault');
  });

  it('honours a custom fallback', () => {
    expect(safeInternalPath('http://x', '/audit')).toBe('/audit');
  });
});
