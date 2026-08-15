/**
 * Tests for POST /api/caregivers/interest — the G1 capture endpoint.
 *
 * 🔴 WHY THIS FILE EXISTS AT ALL. The route had no test, and it returned
 * `{ok:true}` whenever EITHER leg of `recordLead` succeeded:
 *
 *     if (!outcome.stored && !outcome.notified) → 500
 *
 * That reads as generous, and for a transient database blip it is exactly
 * right — the operator email is the durable record, so a lost row costs
 * analysis rather than the lead. But the same line makes a PERMANENTLY
 * unwritable `caregiver_leads` indistinguishable from a healthy one: every
 * visitor is told ok, every operator gets their email, and the only number the
 * G1 gate actually reads sits at zero with nothing anywhere reporting a fault.
 *
 * caregiver_leads is not an ordinary table. PROJECT.yaml calls it "the input to
 * the G1 gate — the measurement that decides whether the product has a market."
 * A silent undercount there is a wrong decision about the business, arrived at
 * with total confidence.
 *
 * This becomes load-bearing with the planned role split: `relay_dev` is
 * deliberately REVOKEd from inserting here so a laptop cannot manufacture
 * demand. A wall nobody can see hit is not a wall.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../lib/g1/leads', async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>('../../../../../lib/g1/leads');
  return { ...actual, recordLead: vi.fn() };
});

import { recordLead, LeadValidationError } from '../../../../../lib/g1/leads';
import { POST } from './route';

const mockRecordLead = vi.mocked(recordLead);

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/caregivers/interest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/caregivers/interest', () => {
  it('reports success when the lead is stored', async () => {
    mockRecordLead.mockResolvedValue({ stored: true, notified: true });

    const res = await POST(req({ email: 'a@b.com' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  /*
    The deliberate soft case, pinned so the fix below cannot accidentally
    harden it. A transient storage failure with the email away is a success for
    the visitor: we have their address and somebody will reply. Turning this
    into an error would ask a caregiver to try again for our benefit, not
    theirs.
  */
  it('still reports success when the row failed transiently but the email went out', async () => {
    mockRecordLead.mockResolvedValue({ stored: false, notified: true });

    const res = await POST(req({ email: 'a@b.com' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('fails when neither leg worked', async () => {
    mockRecordLead.mockResolvedValue({ stored: false, notified: false });

    const res = await POST(req({ email: 'a@b.com' }));
    expect(res.status).toBe(500);
  });

  /*
    The defect. A refused write is a misconfiguration that will not heal, and
    the email succeeding must not paper over it — in production this 500 is what
    reaches `onRequestError` and pages somebody, and on a laptop it is what makes
    the revoked-INSERT wall visible instead of silent.
  */
  it('fails LOUDLY when the write was refused, even though the email went out', async () => {
    mockRecordLead.mockResolvedValue({ stored: false, notified: true, storeDenied: true });

    const res = await POST(req({ email: 'a@b.com' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    // A distinct code: this is never a visitor problem and never a retry.
    expect(body.error).toBe('CaptureRefused');
  });

  it('still returns 400 for a bad address, which is the visitor’s to fix', async () => {
    mockRecordLead.mockRejectedValue(new LeadValidationError('That does not look like an email address.'));

    const res = await POST(req({ email: 'nope' }));
    expect(res.status).toBe(400);
  });
});
