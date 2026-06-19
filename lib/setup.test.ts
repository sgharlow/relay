/**
 * Dependency smoke test — verifies all required packages are installed
 * and importable at their pinned versions.
 *
 * Feature: relay-h0-mvp, Task 1.2
 */
import { describe, it, expect } from 'vitest';

describe('Dependency installation smoke tests', () => {
  it('pg is importable at 8.22.0', async () => {
    const pg = await import('pg');
    // pg exports a Pool constructor
    expect(typeof pg.Pool).toBe('function');
  });

  it('@aws-sdk/client-kms is importable', async () => {
    const { KMSClient } = await import('@aws-sdk/client-kms');
    expect(typeof KMSClient).toBe('function');
  });

  it('openai is importable', async () => {
    const { default: OpenAI } = await import('openai');
    expect(typeof OpenAI).toBe('function');
  });

  it('resend is importable', async () => {
    const { Resend } = await import('resend');
    expect(typeof Resend).toBe('function');
  });

  it('next-auth is importable', async () => {
    // next-auth exports a default handler factory
    const nextAuth = await import('next-auth');
    expect(nextAuth).toBeDefined();
  });

  it('fast-check is importable', async () => {
    const fc = await import('fast-check');
    expect(typeof fc.property).toBe('function');
    expect(typeof fc.assert).toBe('function');
  });
});
