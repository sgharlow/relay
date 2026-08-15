/**
 * The webhook's refusals, and the one thing it is allowed to write.
 *
 * The endpoint is unauthenticated by necessity, so every property here is a
 * security property: it must record nothing unsigned, leak nothing through its
 * status code, and store an outcome rather than a message — our bodies carry
 * live access codes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../../../../../lib/notify/delivery-events', () => ({
  recordDeliveryEvent: vi.fn(async () => undefined),
}));

import { recordDeliveryEvent } from '../../../../../lib/notify/delivery-events';
import { POST } from './route';

const mockRecord = vi.mocked(recordDeliveryEvent);

const KEY = Buffer.from('a-test-signing-key-that-is-long-enough');
const SECRET = `whsec_${KEY.toString('base64')}`;

function signed(body: unknown, opts: { secret?: Buffer; id?: string; ts?: number } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? 'msg_1';
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const sig = `v1,${createHmac('sha256', opts.secret ?? KEY).update(`${id}.${ts}.${raw}`).digest('base64')}`;
  const headers: Record<string, string> = {
    'svix-id': id,
    'svix-timestamp': String(ts),
    'svix-signature': sig,
    'content-length': String(raw.length),
  };
  return {
    text: async () => raw,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.RESEND_WEBHOOK_SECRET;
});

const BOUNCE = {
  type: 'email.bounced',
  data: {
    email_id: 'e_123',
    to: ['alex@example.org'],
    bounce: { type: 'Permanent', subType: 'Suppressed', message: 'On suppression list' },
  },
};

describe('POST /api/resend/webhook', () => {
  it('records a signed bounce against the address', async () => {
    const res = await POST(signed(BOUNCE));
    expect(res.status).toBe(204);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'alex@example.org',
        event: 'email.bounced',
        providerId: 'e_123',
      }),
    );
    // The reason travels; the message never does.
    expect(mockRecord.mock.calls[0][0].detail).toContain('Suppressed');
  });

  it('records NOTHING when the signature is wrong', async () => {
    const forged = signed(BOUNCE, { secret: Buffer.from('not-the-real-signing-key-at-all') });
    const res = await POST(forged);
    expect(res.status).toBe(204);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  /*
    🔴 THE FORGERY THAT WOULD MATTER MOST. Anyone able to write "delivered"
    could hide a real bounce and manufacture a false green on the exact screen
    built to remove one. Same refusal, asserted separately so the intent is on
    the record.
  */
  it('records NOTHING when an unsigned caller claims a DELIVERY', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { to: ['alex@example.org'] } });
    const res = await POST({
      text: async () => raw,
      headers: { get: () => null },
    } as never);
    expect(res.status).toBe(204);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('records nothing when no secret is configured — inert, not open', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await POST(signed(BOUNCE));
    expect(res.status).toBe(204);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('answers a constant 204 to every case, so nothing can be probed', async () => {
    const cases = [
      signed(BOUNCE),
      signed(BOUNCE, { secret: Buffer.from('wrong-key-here-but-long-enough!') }),
      signed({ type: 'email.bounced', data: {} }), // no recipient
      signed({ data: { to: ['a@b.com'] } }), // no type
    ];
    for (const c of cases) expect((await POST(c)).status).toBe(204);
  });

  it('refuses an oversized declared body without reading it', async () => {
    const headers: Record<string, string> = { 'content-length': String(64 * 1024) };
    let read = false;
    const res = await POST({
      text: async () => {
        read = true;
        return '{}';
      },
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as never);
    expect(res.status).toBe(204);
    expect(read).toBe(false);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('survives a recording failure without asking Resend to retry forever', async () => {
    mockRecord.mockRejectedValueOnce(new Error('DSQL unavailable'));
    const res = await POST(signed(BOUNCE));
    expect(res.status).toBe(204);
  });

  it('takes the first address when `to` is an array, and accepts a bare string', async () => {
    await POST(signed({ type: 'email.delivered', data: { to: 'solo@example.org' } }));
    expect(mockRecord.mock.calls[0][0].email).toBe('solo@example.org');
  });

  /*
    🔴 WIRING, AND IT IS THE WHOLE FIX. The decision about whose mail we keep
    lives in `recordDeliveryEvent` — which is right, because that is the seam
    every write passes through — but a rule that is never handed the field it
    reads is a rule that always says yes. This route mocks that module, so
    nothing else in this file can notice the omission; without this test the
    guard would sit there looking correct while 70 rows of another product's
    mail carried on arriving, which is exactly the state production was in.
  */
  it('hands the sender to the recorder, which is what makes the guard reachable', async () => {
    await POST(
      signed({
        type: 'email.bounced',
        data: { to: ['x@example.org'], from: 'ReportBridge <monitor@report-bridge.com>' },
      }),
    );
    expect(mockRecord.mock.calls[0][0].from).toBe('ReportBridge <monitor@report-bridge.com>');
  });
});
