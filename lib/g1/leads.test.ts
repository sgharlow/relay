/**
 * Tests for G1 lead capture.
 *
 * The behaviour worth pinning is the resilience shape: a lead must survive the
 * loss of EITHER leg, and only a double failure may be reported as a failure.
 * Get that backwards and a working funnel looks broken, or — far worse — a
 * broken one looks like an absence of demand, which is what the gate kills on.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendEmail = vi.fn();
const query = vi.fn();

vi.mock('../notify/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('../db/connection', () => ({ query: (...a: unknown[]) => query(...a) }));

import { recordLead, validateLead, normaliseEmail, LeadValidationError, MAX_NOTE_LENGTH } from './leads';

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue(undefined);
  query.mockReset().mockResolvedValue({ rows: [] });
  process.env.LEAD_NOTIFY_ADDRESS = 'ops@example.com';
});
afterEach(() => {
  delete process.env.LEAD_NOTIFY_ADDRESS;
  vi.unstubAllEnvs();
});

describe('validateLead', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(normaliseEmail('  Steve@Example.COM ')).toBe('steve@example.com');
    expect(validateLead({ email: '  Steve@Example.COM ' }).email).toBe('steve@example.com');
  });

  it.each([
    'a@b.com',
    'first.last+tag@sub.domain.co.uk',
    "o'brien@example.org",
  ])('accepts the real-world address %s', (email) => {
    expect(validateLead({ email }).email).toBe(email.toLowerCase());
  });

  it.each(['', '   ', 'nope', 'no@domain', '@example.com', 'two parts@example.com'])(
    'rejects %j',
    (email) => {
      expect(() => validateLead({ email })).toThrow(LeadValidationError);
    },
  );

  it('drops an empty note rather than storing whitespace', () => {
    expect(validateLead({ email: 'a@b.com', note: '   ' }).note).toBeUndefined();
  });

  it('rejects an oversized note', () => {
    expect(() => validateLead({ email: 'a@b.com', note: 'x'.repeat(MAX_NOTE_LENGTH + 1) })).toThrow(
      /under 1000/,
    );
  });

  it('gives the visitor a message they can act on, not an internal one', () => {
    expect(() => validateLead({ email: 'nope' })).toThrow(/does not look like an email/);
  });
});

describe('recordLead resilience', () => {
  it('reports both legs on the happy path', async () => {
    await expect(recordLead({ email: 'a@b.com' })).resolves.toEqual({ stored: true, notified: true });
  });

  it('STILL STORES when the notification email fails', async () => {
    sendEmail.mockRejectedValue(new Error('resend down'));
    await expect(recordLead({ email: 'a@b.com' })).resolves.toEqual({ stored: true, notified: false });
  });

  it('records notified=false on the row, so a lost email is visible later', async () => {
    sendEmail.mockRejectedValue(new Error('resend down'));
    await recordLead({ email: 'a@b.com' });
    expect(query.mock.calls[0][1]).toContain(false);
  });

  it('STILL NOTIFIES when the database write fails', async () => {
    query.mockRejectedValue(new Error('dsql unavailable'));
    await expect(recordLead({ email: 'a@b.com' })).resolves.toEqual({ stored: false, notified: true });
  });

  it('reports total failure only when BOTH legs fail', async () => {
    sendEmail.mockRejectedValue(new Error('resend down'));
    query.mockRejectedValue(new Error('dsql unavailable'));
    await expect(recordLead({ email: 'a@b.com' })).resolves.toEqual({ stored: false, notified: false });
  });

  it('never lets a leg failure escape as an exception', async () => {
    sendEmail.mockRejectedValue(new Error('boom'));
    query.mockRejectedValue(new Error('boom'));
    await expect(recordLead({ email: 'a@b.com' })).resolves.toBeDefined();
  });

  it('validates BEFORE writing anything', async () => {
    await expect(recordLead({ email: 'nope' })).rejects.toThrow(LeadValidationError);
    expect(query).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('recordLead attribution and content', () => {
  it('persists the channel and CTA that paid for the lead', async () => {
    await recordLead({ email: 'a@b.com', note: 'dad in hospital', src: 'reddit', cta: 'hero' });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['a@b.com', 'dad in hospital', 'reddit', 'hero', true, null, null]);
  });

  it('stores nulls, not undefined, for absent optional columns', async () => {
    await recordLead({ email: 'a@b.com' });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params.slice(1, 4)).toEqual([null, null, null]);
  });

  it('sets reply-to to the LEAD so replying reaches the caregiver', async () => {
    await recordLead({ email: 'caregiver@example.com' });
    expect(sendEmail.mock.calls[0][0].replyTo).toBe('caregiver@example.com');
  });

  it('puts the channel in the subject so leads trace to an ad at a glance', async () => {
    await recordLead({ email: 'a@b.com', src: 'reddit' });
    expect(sendEmail.mock.calls[0][0].subject).toContain('reddit');
  });

  it('includes the note in the body', async () => {
    await recordLead({ email: 'a@b.com', note: 'mum has dementia' });
    expect(sendEmail.mock.calls[0][0].text).toContain('mum has dementia');
  });

  /*
    🔴 A LEAD IS THE ONE EMAIL THAT MUST NOT BE AMBIGUOUS ABOUT WHERE IT CAME
    FROM, because it is not really an email — it is the G1 gate's measurement
    arriving in an inbox. PROJECT.yaml calls caregiver_leads "the input to the
    G1 gate — the measurement that decides whether the product has a market",
    and the portfolio rule it serves is that the signal must be ARMS-LENGTH. A
    lead the team generated is the exact opposite of the thing being measured.

    Nothing stops a `next dev` server producing one. .env.local carries the
    production Resend key and points at the production cluster (no dev
    database), so submitting the landing form locally emails the real operator
    inbox and writes a real row. On 2026-08-15 the sibling case actually fired:
    an ops alert from a laptop claiming to be production, believed because it
    said so. The subscriber row is real, caregiver_leads is at 0, and this is
    latent — which is the moment to close it, not after a row lands.

    Blocking the write is NOT this test's call: whether a dev server may record
    a G1 lead at all is Steve's gate decision, and suppressing the email alone
    would HIDE a contaminated row rather than prevent it. So the honest minimum
    is that the notification says what it is, and a dev-origin lead can never be
    counted as demand by mistake.
  */
  it('says which environment a lead came from, so a dev-origin one cannot pass as demand', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    await recordLead({ email: 'a@b.com', src: 'reddit' });

    const { subject, text } = sendEmail.mock.calls[0][0];
    expect(`${subject} ${text}`).toMatch(/development/i);
    // Loud enough that it cannot be skimmed past in an inbox.
    expect(subject).toMatch(/NOT PRODUCTION/i);
  });

  it('says nothing extra about a real production lead', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    await recordLead({ email: 'a@b.com', src: 'reddit' });

    const { subject, text } = sendEmail.mock.calls[0][0];
    expect(subject).not.toMatch(/NOT PRODUCTION/i);
    expect(subject).toContain('reddit');
    expect(text).toContain('a@b.com');
  });

  it('still stores when no notify address is configured', async () => {
    delete process.env.LEAD_NOTIFY_ADDRESS;
    delete process.env.RESEND_REPLY_TO_ADDRESS;
    await expect(recordLead({ email: 'a@b.com' })).resolves.toEqual({ stored: true, notified: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to the reply-to inbox when LEAD_NOTIFY_ADDRESS is unset', async () => {
    delete process.env.LEAD_NOTIFY_ADDRESS;
    process.env.RESEND_REPLY_TO_ADDRESS = 'fallback@example.com';
    await recordLead({ email: 'a@b.com' });
    expect(sendEmail.mock.calls[0][0].to).toBe('fallback@example.com');
    delete process.env.RESEND_REPLY_TO_ADDRESS;
  });
});

describe('ad attribution', () => {
  it('stores the click platform and ID on the row', async () => {
    // Without these, "reddit-ads produced 40 leads" is the most specific thing
    // that can ever be said, and no offline conversion can be uploaded.
    await recordLead({
      email: 'a@b.com',
      src: 'reddit-ads',
      clickPlatform: 'reddit',
      clickId: 'rd_7',
    });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('reddit');
    expect(params).toContain('rd_7');
  });

  it('stores nulls for an organic arrival rather than failing', async () => {
    // Most leads have no click ID. A lead without one is still a lead, and
    // nothing in the funnel may require it.
    await expect(recordLead({ email: 'a@b.com' })).resolves.toMatchObject({ stored: true });
  });

  it('caps a click ID the client could have lengthened', async () => {
    // The browser cap is a convenience; this endpoint is public, so the only
    // cap that counts is the one on this side.
    await recordLead({ email: 'a@b.com', clickPlatform: 'google', clickId: 'x'.repeat(900) });
    const params = query.mock.calls[0][1] as unknown[];
    const stored = params.find((p) => typeof p === 'string' && p.startsWith('xxx')) as string;
    expect(stored.length).toBeLessThanOrEqual(255);
  });
});
