/**
 * Tests for the email boundary.
 *
 * THE BUG THESE EXIST FOR (found 2026-08-07): the Resend SDK does not throw on
 * API errors — it resolves with { data, error }. sendEmail awaited that promise
 * and inspected neither field, so every failed send was reported as a success.
 * A rejected recipient, a restricted sending domain and an invalid address all
 * looked exactly like delivery, sendEmailBestEffort never logged because there
 * was never an exception, and the entire notification layer failed silently.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Resend } from 'resend';

import { sendEmail, sendEmailBestEffort, _setResendClientForTesting } from './email';

function stub(response: unknown): Resend {
  return { emails: { send: vi.fn(async () => response) } } as unknown as Resend;
}

beforeEach(() => {
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.RESEND_API_KEY = 'test-key';
});
afterEach(() => _setResendClientForTesting(null));

describe('sendEmail', () => {
  it('resolves when Resend returns a message id', async () => {
    _setResendClientForTesting(stub({ data: { id: 'msg-1' }, error: null }));
    await expect(sendEmail({ to: 'a@b.com', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('THROWS when Resend returns an error, even though the promise resolved', async () => {
    _setResendClientForTesting(
      stub({ data: null, error: { name: 'validation_error', message: 'You can only send testing emails to your own address' } }),
    );

    await expect(sendEmail({ to: 'other@b.com', subject: 's', text: 't' })).rejects.toThrow(
      /validation_error/,
    );
  });

  it('surfaces the provider message so the cause is diagnosable', async () => {
    _setResendClientForTesting(stub({ data: null, error: { name: 'restricted', message: 'verify a domain' } }));
    await expect(sendEmail({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toThrow(/verify a domain/);
  });

  it('THROWS when no message id comes back — absence of proof is not delivery', async () => {
    _setResendClientForTesting(stub({ data: null, error: null }));
    await expect(sendEmail({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toThrow(/message id/);
  });

  it('throws when the from-address is unset', async () => {
    delete process.env.RESEND_FROM_ADDRESS;
    _setResendClientForTesting(stub({ data: { id: 'x' }, error: null }));
    await expect(sendEmail({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toThrow(/RESEND_FROM_ADDRESS/);
  });
});

describe('sendEmailBestEffort', () => {
  it('returns TRUE only on a genuine accept', async () => {
    _setResendClientForTesting(stub({ data: { id: 'msg-1' }, error: null }));
    await expect(sendEmailBestEffort({ to: 'a@b.com', subject: 's', text: 't' })).resolves.toBe(true);
  });

  it('returns FALSE on a provider rejection — previously it returned true', async () => {
    _setResendClientForTesting(stub({ data: null, error: { name: 'validation_error', message: 'nope' } }));
    await expect(sendEmailBestEffort({ to: 'a@b.com', subject: 's', text: 't' })).resolves.toBe(false);
  });
});
