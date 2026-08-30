/**
 * Somebody asking for help — on a product that is deliberately unrecoverable.
 *
 * This handler executed no test until 2026-08-30. Its header states why it
 * matters more here than for most products: "the people who most need to reach a
 * human are exactly the people nothing in the product can rescue."
 *
 * 🔴 THE REPLY ADDRESS GOES IN THE BODY, NEVER THE `From` HEADER. Sending as the
 * visitor would fail SPF for relaystandby.com and — worse — teach the mail
 * provider that this domain forges senders, which is the same sending reputation
 * every release notice depends on. A support form is not worth the deliverability
 * of the emergency mail.
 *
 * 🔴 A SEND FAILURE IS REPORTED HONESTLY. Everywhere else in this codebase mail
 * is best-effort because the operation must not depend on it. Here the message IS
 * the operation, and a cheerful confirmation for a message that never left leaves
 * somebody waiting for an answer that is not coming.
 *
 * 🔴 THE HONEYPOT ANSWERS WITH AN ORDINARY 200. A distinguishable refusal is a
 * signal a bot adapts to, so the discard must be invisible from outside — which
 * means the only way to assert it is that no mail was sent.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../lib/notify/email', () => ({
  sendEmailBestEffort: vi.fn(async () => true),
}));
vi.mock('../../../../lib/http/rate-limit', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/rate-limit',
  );
  return { ...actual, rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) };
});

import { sendEmailBestEffort } from '../../../../lib/notify/email';
import { rateLimit } from '../../../../lib/http/rate-limit';
import { CONTACT_EMAIL } from '../../../../lib/contact';
import { POST } from './route';

const mockSend = vi.mocked(sendEmailBestEffort);
const mockRateLimit = vi.mocked(rateLimit);

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://relaystandby.com/api/support', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const GOOD = { message: 'My access code will not work.', email: 'april@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockSend.mockResolvedValue(true as never);
});

describe('a person asks for help', () => {
  it('sends the message to the support address and confirms', async () => {
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe(CONTACT_EMAIL);
  });

  it('carries the reply address in the body, never as the sender', async () => {
    await POST(req(GOOD));
    // Through `unknown`: EmailMessage has no index signature, and the point of
    // this assertion is to look for keys the type says cannot be there.
    const sent = mockSend.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(String(sent.text)).toContain('From: april@example.com');
    // The visitor's address must not be used as an envelope/From identity.
    expect(sent).not.toHaveProperty('from');
    expect(sent).not.toHaveProperty('replyTo');
    expect(sent.to).toBe(CONTACT_EMAIL);
  });

  it('includes the page they were on when it is supplied', async () => {
    await POST(req({ ...GOOD, from: '/access' }));
    expect(String(mockSend.mock.calls[0][0].text)).toContain('Page: /access');
  });

  it('omits the page line when it is not', async () => {
    await POST(req(GOOD));
    expect(String(mockSend.mock.calls[0][0].text)).not.toContain('Page:');
  });

  it('truncates a long message rather than refusing it', async () => {
    /*
      ⚠️ TWO CEILINGS THAT ARE NOT THE SAME NUMBER, and the gap between them is
      the only place truncation is observable. MAX_MESSAGE is 4000 CHARACTERS;
      MAX_BODY_BYTES is 8192 BYTES and is enforced first, by readJson, against
      the stream. So a 5000-character message is truncated to 4000 and sent, and
      a 9000-character one never reaches the truncation at all — it is refused
      as a payload. Asserted as a pair because testing only the second would
      leave the truncation branch unexercised while looking thorough.
    */
    const res = await POST(req({ ...GOOD, message: 'x'.repeat(5000) }));
    expect(res.status).toBe(200);
    const text = String(mockSend.mock.calls[0][0].text);
    expect(text).toContain('x'.repeat(4000));
    expect(text).not.toContain('x'.repeat(4001));
  });

  it('refuses a message past the body ceiling before truncating anything', async () => {
    const res = await POST(req({ ...GOOD, message: 'x'.repeat(9000) }));
    expect(res.status).toBe(413);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('refuses an empty message and sends nothing', async () => {
    const res = await POST(req({ message: '   ', email: 'a@b.com' }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('refuses without a reply address, because a dead-end helps nobody', async () => {
    const res = await POST(req({ message: 'help', email: 'not-an-address' }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('refuses a body that declares itself too large, before reading it', async () => {
    const res = await POST(req(GOOD, { 'content-length': String(9 * 1024) }));
    expect(res.status).toBe(413);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('refuses over the rate limit with a Retry-After', async () => {
    mockRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 120 });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('meters on a key scoped to this route', async () => {
    await POST(req(GOOD));
    expect(String(mockRateLimit.mock.calls[0][0])).toMatch(/^support:/);
  });
});

describe('the honeypot', () => {
  it('discards a filled honeypot behind an ordinary 200', async () => {
    const res = await POST(req({ ...GOOD, company: 'Acme Ltd' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The only observable difference, and it is not observable from outside.
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('is not tripped by an empty honeypot field', async () => {
    const res = await POST(req({ ...GOOD, company: '   ' }));
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('when the send itself fails', () => {
  it('says so rather than confirming, and offers the address to write to', async () => {
    mockSend.mockResolvedValueOnce(false as never);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: 'SendFailed',
      contact: CONTACT_EMAIL,
    });
  });
});
