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

/** The payload handed to Resend by the most recent send. */
function sentPayload(client: Resend): Record<string, unknown> {
  const send = client.emails.send as unknown as { mock: { calls: unknown[][] } };
  return send.mock.calls.at(-1)![0] as Record<string, unknown>;
}

const ok = { data: { id: 'msg-1' }, error: null };

beforeEach(() => {
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.RESEND_REPLY_TO_ADDRESS;
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

/**
 * TEST 2 of the Outlook investigation, at the seam where it either reaches the
 * provider or does not.
 *
 * `text-to-html.test.ts` proves the HTML is correct. It cannot prove the send
 * PASSES it — and that gap is the exact shape of the defect this whole file
 * exists for, where a function looked healthy and nothing it produced ever
 * reached Resend intact. So: assert on the payload handed to the SDK.
 */
describe('multipart/alternative — the html part reaches the provider', () => {
  it('sends BOTH parts, so Resend emits multipart/alternative', async () => {
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmail({ to: 'a@b.com', subject: 's', text: 'Hi Alex,\n\nYou were named.' });

    const payload = sentPayload(client);
    expect(payload.text, 'the text part must remain authoritative').toBe(
      'Hi Alex,\n\nYou were named.',
    );
    expect(String(payload.html)).toContain('<!doctype html>');
    expect(String(payload.html)).toContain('You were named.');
  });

  it('the text part is byte-identical to the caller-supplied body — one variable', async () => {
    // The experiment is "add an alternative part", nothing else. If the SCL
    // moves, the reason has to be unambiguous, so the text may not drift by so
    // much as a newline. Test 3 (a subject without "Action needed") stays unrun.
    const body = `Hi Alex,\n\n    4KMPQ-7XR2W\n\nCase RLY-DECY-X347.\n`;
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmail({ to: 'a@b.com', subject: 'Action needed: confirm', text: body });

    expect(sentPayload(client).text).toBe(body);
    expect(sentPayload(client).subject).toBe('Action needed: confirm');
  });
});

/**
 * The From address (relay@relaystandby.com) has no MX record behind it, so a
 * reply to it reaches nobody. These pin the header that makes replies land.
 */
describe('reply-to', () => {
  it('sets Reply-To from RESEND_REPLY_TO_ADDRESS', async () => {
    process.env.RESEND_REPLY_TO_ADDRESS = 'inbox@example.com';
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmail({ to: 'a@b.com', subject: 's', text: 't' });

    expect(sentPayload(client).replyTo).toBe('inbox@example.com');
  });

  it('lets a caller override the env default per message', async () => {
    process.env.RESEND_REPLY_TO_ADDRESS = 'inbox@example.com';
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmail({ to: 'a@b.com', subject: 's', text: 't', replyTo: 'support@example.com' });

    expect(sentPayload(client).replyTo).toBe('support@example.com');
  });

  it('OMITS the header entirely when unset — an empty Reply-To is malformed', async () => {
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmail({ to: 'a@b.com', subject: 's', text: 't' });

    expect(sentPayload(client)).not.toHaveProperty('replyTo');
  });

  it('treats a whitespace-only env value as unset', async () => {
    process.env.RESEND_REPLY_TO_ADDRESS = '   ';
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmail({ to: 'a@b.com', subject: 's', text: 't' });

    expect(sentPayload(client)).not.toHaveProperty('replyTo');
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
