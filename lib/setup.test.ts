/**
 * Dependency smoke test — verifies all required packages are installed
 * and importable at their pinned versions.
 *
 * Feature: relay-h0-mvp, Task 1.2
 */
import { describe, it, expect } from 'vitest';

/**
 * ⚠️ 20s PER TEST, NOT THE 5s DEFAULT — contention, not slowness.
 *
 * Every test in this file dynamically imports a large third-party package
 * (`openai`, `resend`, `next-auth`, the AWS SDK). Alone each takes well under a
 * second. Inside the full suite, with 312 files transforming and importing in
 * parallel, they intermittently blow the 5s budget: measured 2026-08-21, one or
 * another of these timed out in two of three full-suite runs while passing every
 * time in isolation. `lib/release/grace-window-invariant.test.ts` had the same
 * failure for the same reason and carries the longer version of this note.
 *
 * 🔴 A GATE THAT GOES RED ON MACHINE LOAD teaches people that red means nothing,
 * which costs exactly what a false green costs. This repo keeps recording the
 * green half of that lesson; this is the red half. The assertions are unchanged
 * — only the time they are allowed to take.
 *
 * If these fire again at 20s, the finding is that a dependency's import cost has
 * grown materially, which is worth knowing — not that the timeout is still small.
 */
const IMPORT_TIMEOUT = { timeout: 20_000 };

describe('Dependency installation smoke tests', () => {
  it('pg is importable at 8.22.0', IMPORT_TIMEOUT, async () => {
    const pg = await import('pg');
    // pg exports a Pool constructor
    expect(typeof pg.Pool).toBe('function');
  });

  it('@aws-sdk/client-kms is importable', IMPORT_TIMEOUT, async () => {
    const { KMSClient } = await import('@aws-sdk/client-kms');
    expect(typeof KMSClient).toBe('function');
  });

  it('openai is importable', IMPORT_TIMEOUT, async () => {
    const { default: OpenAI } = await import('openai');
    expect(typeof OpenAI).toBe('function');
  });

  it('resend is importable', IMPORT_TIMEOUT, async () => {
    const { Resend } = await import('resend');
    expect(typeof Resend).toBe('function');
  });

  it('next-auth is importable', IMPORT_TIMEOUT, async () => {
    // next-auth exports a default handler factory
    const nextAuth = await import('next-auth');
    expect(nextAuth).toBeDefined();
  });

  it('fast-check is importable', IMPORT_TIMEOUT, async () => {
    const fc = await import('fast-check');
    expect(typeof fc.property).toBe('function');
    expect(typeof fc.assert).toBe('function');
  });
});
