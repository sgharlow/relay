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

import {
  sendEmail,
  sendEmailBestEffort,
  sendEmailToAllBestEffort,
  _setResendClientForTesting,
} from './email';

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
  delete process.env.DEV_MAIL_ALLOWLIST;
  // These assert what a PRODUCTION send does. Outbound mail is gated on the
  // environment since 2026-08-15, and under vitest NODE_ENV is 'test' —
  // positively not production, and correctly refused.
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => {
  _setResendClientForTesting(null);
  vi.unstubAllEnvs();
});

/*
  🔴 A LAPTOP COULD MAIL A REAL CAREGIVER.

  `.env.local` carries the production Resend key and points at the production
  cluster, because Relay has no dev database. So a `next dev` server running any
  notification path — an invitation, a verifier notice, an access request — sent
  a real email, from the real sending domain, to whatever address was in the
  row. The ops-alert path was gated on 2026-08-15; this one was not, and it is
  the one that reaches customers rather than operators.

  The guard is an explicit allow-list rather than a domain rule, and the reason
  is that the obvious rule is backwards here. `assertDeliverableDomain` already
  REFUSES .test/.invalid/.localhost — reserved domains cannot receive mail, and
  burning reputation on them is self-harm on an account shared with
  report-bridge. So "outside production, only reserved domains" would permit
  exactly the set that is already blocked, i.e. nothing. The only way to test
  mail off production is a real address somebody controls, so that is what gets
  named.

  The three E2E walks are unaffected: they make no mail assertions at all, and
  their accounts are on reserved domains that were already refused.
*/
describe('mail from a non-production environment', () => {
  it('refuses a real recipient, loudly', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    const client = stub(ok);
    _setResendClientForTesting(client);

    await expect(sendEmail({ to: 'a-real-caregiver@gmail.com', subject: 's', text: 't' }))
      .rejects.toThrow(/development/i);

    const send = client.emails.send as unknown as { mock: { calls: unknown[][] } };
    expect(send.mock.calls, 'the provider must not even be asked').toHaveLength(0);
  });

  it('allows an address explicitly named for dev testing', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    process.env.DEV_MAIL_ALLOWLIST = 'me@example.com, other@example.com';
    const client = stub(ok);
    _setResendClientForTesting(client);

    await expect(sendEmail({ to: 'other@example.com', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('is case- and whitespace-insensitive about the allow-list', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    process.env.DEV_MAIL_ALLOWLIST = '  Me@Example.com  ';
    _setResendClientForTesting(stub(ok));

    await expect(sendEmail({ to: 'me@example.com', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('does not consult the allow-list in production', async () => {
    // Production must never depend on a variable nobody sets there.
    vi.stubEnv('VERCEL_ENV', 'production');
    delete process.env.DEV_MAIL_ALLOWLIST;
    _setResendClientForTesting(stub(ok));

    await expect(sendEmail({ to: 'anyone@gmail.com', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('still refuses a reserved domain outside production, allow-listed or not', async () => {
    // The two guards are orthogonal and both apply.
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    process.env.DEV_MAIL_ALLOWLIST = 'nobody@relay.test';
    _setResendClientForTesting(stub(ok));

    await expect(sendEmail({ to: 'nobody@relay.test', subject: 's', text: 't' }))
      .rejects.toThrow(/reserved/i);
  });
});

/**
 * Fanning one message out to a person's two addresses.
 *
 * The point of a second address is that the first one may be silently junked,
 * so the failure mode that matters here is a partial one: if the primary is
 * refused and the backup is accepted, the person WAS reached and the caller
 * must be told so.
 */
describe('sendEmailToAllBestEffort', () => {
  it('sends one message per address', async () => {
    const client = stub(ok);
    _setResendClientForTesting(client);

    await sendEmailToAllBestEffort(['a@b.com', 'a@c.com'], { subject: 's', text: 't' });

    const send = client.emails.send as unknown as { mock: { calls: unknown[][] } };
    expect(send.mock.calls).toHaveLength(2);
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(['a@b.com', 'a@c.com']);
  });

  it('reports success when the BACKUP got through and the primary did not', async () => {
    let call = 0;
    _setResendClientForTesting({
      emails: {
        send: vi.fn(async () =>
          call++ === 0 ? { data: null, error: { name: 'bounced', message: 'no' } } : ok,
        ),
      },
    } as unknown as Resend);

    await expect(
      sendEmailToAllBestEffort(['dead@b.com', 'alive@c.com'], { subject: 's', text: 't' }),
    ).resolves.toBe(true);
  });

  it('reports failure only when EVERY address failed', async () => {
    _setResendClientForTesting(stub({ data: null, error: { name: 'bounced', message: 'no' } }));
    await expect(
      sendEmailToAllBestEffort(['a@b.com', 'a@c.com'], { subject: 's', text: 't' }),
    ).resolves.toBe(false);
  });

  it('is an ordinary single send when there is one address', async () => {
    const client = stub(ok);
    _setResendClientForTesting(client);
    await expect(
      sendEmailToAllBestEffort(['a@b.com'], { subject: 's', text: 't' }),
    ).resolves.toBe(true);
    expect((client.emails.send as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
  });

  it('sends nothing, and claims nothing, for an empty list', async () => {
    const client = stub(ok);
    _setResendClientForTesting(client);
    await expect(sendEmailToAllBestEffort([], { subject: 's', text: 't' })).resolves.toBe(false);
    expect((client.emails.send as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
  });
});

/**
 * 🔴 AN ADDRESS THAT CAN NEVER RECEIVE MAIL IS NEVER WORTH THE REPUTATION.
 *
 * `demo@relay.test` is a live seeded account in production, and
 * `email_delivery_events` holds 18 failures for that domain — measured
 * 2026-08-14. `lib/seed/demo-data.ts` asserts in a comment that "nothing
 * addresses mail to the demo owner"; three paths do (a verifier confirming, a
 * break-glass redemption, and a script), which is why the guard cannot live at
 * the call sites. RFC 6761 reserves `.test`, `.invalid` and `.localhost`; no
 * mail can ever be delivered to them, so every such send is pure cost —
 * retries, then failures, on a Resend account SHARED with report-bridge. And
 * sending reputation is the surviving explanation for the Outlook filing this
 * product has been chasing, so burning it on undeliverable addresses is
 * self-harm.
 *
 * `example.com` and friends are deliberately NOT blocked: they are reserved
 * second-level domains used throughout this suite's fixtures, and they are not
 * what is costing us anything.
 */
describe('reserved-TLD addresses are refused before the provider is called', () => {
  it.each(['demo@relay.test', 'someone@my.invalid', 'root@box.localhost'])(
    'refuses %s',
    async (to) => {
      const client = stub(ok);
      _setResendClientForTesting(client);

      await expect(sendEmail({ to, subject: 's', text: 't' })).rejects.toThrow(/never receive/i);
      expect(
        (client.emails.send as unknown as { mock: { calls: unknown[][] } }).mock.calls,
        'the provider must not be asked to try',
      ).toHaveLength(0);
    },
  );

  it('is caught by the best-effort wrapper like any other failure', async () => {
    _setResendClientForTesting(stub(ok));
    await expect(
      sendEmailBestEffort({ to: 'demo@relay.test', subject: 's', text: 't' }),
    ).resolves.toBe(false);
  });

  it('leaves example.com alone — reserved, but harmless and used by every fixture here', async () => {
    _setResendClientForTesting(stub(ok));
    await expect(
      sendEmail({ to: 'lee@example.com', subject: 's', text: 't' }),
    ).resolves.toBeUndefined();
  });

  it('does not fire on a real domain that merely contains the word test', async () => {
    _setResendClientForTesting(stub(ok));
    await expect(
      sendEmail({ to: 'a@test-results.com', subject: 's', text: 't' }),
    ).resolves.toBeUndefined();
  });
});

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

  /*
    THE MAIL IS THE PRODUCT; THE TELEMETRY ABOUT IT IS NOT. `recordSendAttempt`
    writes the row that lets the dead-man's switch in webhook-health.ts notice a
    stopped event stream, and it runs on the path that delivers a caregiver's
    access code. If a DSQL blip could make that path throw, an outage in the
    monitoring would become an outage in the thing monitored — a strictly worse
    product than having no monitor at all.

    The direction is asserted rather than left to be noticed: this test passes
    today only because the failure is swallowed. Every other test in this file
    exercises the same swallow incidentally (the suite has no database and logs
    the failure on each send), and incidental coverage of a deliberate design
    choice is how that choice gets reversed by somebody tidying up.
  */
  it('still succeeds when the send-attempt record cannot be written', async () => {
    // No DSQL in this suite, so recordSendAttempt's INSERT genuinely fails here.
    _setResendClientForTesting(stub({ data: { id: 'msg-9' }, error: null }));
    await expect(sendEmail({ to: 'a@b.com', subject: 's', text: 't' })).resolves.toBeUndefined();
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
