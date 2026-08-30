/**
 * The single request that hands over every wrapped key in the vault.
 *
 * This handler executed no test until 2026-08-30. Its own header states the
 * stake plainly: the browser then unwraps each key and writes plaintext to disk,
 * so "a walked-away-from machine is one click from a complete, unprotected copy
 * of everything the product exists to protect."
 *
 * 🔴 THE STEP-UP GUARD IS THE WHOLE CONTROL, AND IT MUST RUN BEFORE THE EXPORT
 * IS BUILT. `lib/ops/step-up-guard.ts` fails the build if a declared route drops
 * the call — but that is a structural check on the source, and it cannot say
 * whether a refusal actually STOPS the work. These assert the behaviour: when
 * `requireStepUp` returns a response, `buildAccountExport` is never reached, so
 * no wrapped key is ever assembled for a session that failed to elevate.
 *
 * ⚠️ `requireStepUp` RETURNING `null` IS THE DELIBERATE STAND-DOWN, not a
 * failure. An account with neither TOTP nor a passkey — a freshly-claimed
 * contact — cannot satisfy a guard, and a guard nobody can satisfy is a lockout.
 * The test below records that this route inherits that behaviour rather than
 * asserting the opposite by accident.
 *
 * Feature: relay-h0-mvp
 * Requirements: J13-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../lib/auth/step-up', () => ({ requireStepUp: vi.fn(async () => null) }));
vi.mock('../../../../../lib/account/lifecycle', () => ({ buildAccountExport: vi.fn() }));

import { requireOwner } from '../../../../../lib/http/owner-route';
import { requireStepUp } from '../../../../../lib/auth/step-up';
import { buildAccountExport } from '../../../../../lib/account/lifecycle';
import { GET } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockStepUp = vi.mocked(requireStepUp);
const mockExport = vi.mocked(buildAccountExport);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';

const EXPORT = {
  owner: { email: 'owner@example.com', display_name: 'Margaret' },
  items: [{ id: 'i-1', ciphertext: 'BASE64CIPHER', wrapped_data_key: 'WRAPPED' }],
};

function req(): NextRequest {
  return new NextRequest('https://relaystandby.com/api/account/export');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockStepUp.mockResolvedValue(null);
  mockExport.mockResolvedValue(EXPORT as never);
});

describe('taking your data out', () => {
  it('builds the export for the session owner once elevated', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockExport).toHaveBeenCalledWith(OWNER);
  });

  it('elevates against the SESSION owner, not anything in the request', async () => {
    await GET(req());
    expect(mockStepUp).toHaveBeenCalledWith(expect.anything(), OWNER);
  });

  it('hands over ciphertext, which is all the server has', async () => {
    // The server cannot read vault contents; a plaintext export would mean a
    // server-side decrypt path, which is the guarantee the product is sold on.
    const body = await (await GET(req())).json();
    expect(body.items[0].ciphertext).toBe('BASE64CIPHER');
    expect(body.items[0].wrapped_data_key).toBe('WRAPPED');
  });
});

describe('the step-up guard', () => {
  it('assembles NOTHING when elevation is required and absent', async () => {
    mockStepUp.mockResolvedValueOnce(
      NextResponse.json({ error: 'StepUpRequired' }, { status: 403 }),
    );
    const res = await GET(req());
    expect(res.status).toBe(403);
    // The point of the assertion: not merely that a 403 came back, but that no
    // wrapped key was ever gathered for the unelevated session.
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('checks the session BEFORE it checks elevation', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockStepUp).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('stands down for an account with no step-up factor at all', async () => {
    // requireStepUp returns null for a user holding neither TOTP nor a passkey.
    // Recorded rather than asserted the other way round: a guard nobody can
    // satisfy is a lockout, and this route inherits that decision on purpose.
    mockStepUp.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockExport).toHaveBeenCalledWith(OWNER);
  });
});
