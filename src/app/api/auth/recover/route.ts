/**
 * POST /api/auth/recover — get back in after losing the authenticator.
 *
 * Two steps, mirroring signup:
 *   { email, recoveryCode }            → a new enrolment token + QR secret
 *   { enrolmentToken, code }           → the new authenticator replaces the old
 *
 * Redeeming a code does NOT sign anyone in; it authorises re-enrolment. The
 * account is reachable only once the NEW authenticator produces a valid code,
 * so a stolen recovery code on its own is half of a change, not a session.
 *
 * PUBLIC by necessity — someone who cannot authenticate is the entire audience
 * for this endpoint. The defences are ~50 bits per code, single use, per-IP
 * throttling, and a response that is identical whether the account exists or
 * the code was wrong.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1, 17.1
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  redeemRecoveryCode,
  issueRecoveryCodes,
  replaceTotpSecret,
  formatRecoveryCode,
  RecoveryCodeError,
} from '../../../../../lib/auth/recovery-code';
import {
  beginRecoveryEnrolment,
  completeRecoveryEnrolment,
} from '../../../../../lib/auth/recovery-enrolment';
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';
import { readJson, isResponse } from '../../../../../lib/http/owner-route';
import { ValidationError } from '../../../../../lib/validation';

/** Generous for a flustered person, far too slow to grind ~50 bits with. */
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, 'recover'), LIMIT, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: 'RateLimited', message: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const parsed = await readJson(req);
  if (isResponse(parsed)) return parsed;
  const body = parsed as Record<string, unknown>;

  try {
    // Step two — a new authenticator proves itself and takes over.
    if (typeof body.enrolmentToken === 'string') {
      const code = typeof body.code === 'string' ? body.code : '';
      const { userId, secret } = completeRecoveryEnrolment(body.enrolmentToken, code);
      await replaceTotpSecret(userId, secret);

      // Fresh codes, and the old sheet stops working. After a recovery the
      // previous list is of unknown provenance — it may be why the account
      // needed recovering.
      const codes = await issueRecoveryCodes(userId);
      return NextResponse.json({ recovered: true, recoveryCodes: codes.map(formatRecoveryCode) });
    }

    // Step one — the recovery code buys the right to enrol, nothing more.
    const email = typeof body.email === 'string' ? body.email : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
    if (!email.trim() || !recoveryCode.trim()) {
      return NextResponse.json(
        { error: 'BadRequest', message: 'Enter your email address and one recovery code.' },
        { status: 400 },
      );
    }

    const userId = await redeemRecoveryCode(email, recoveryCode);
    return NextResponse.json(beginRecoveryEnrolment(userId, email));
  } catch (err) {
    if (err instanceof RecoveryCodeError || err instanceof ValidationError) {
      return NextResponse.json({ error: 'RecoveryError', message: err.message }, { status: 400 });
    }
    throw err;
  }
}
