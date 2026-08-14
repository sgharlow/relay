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
import { bumpSessionEpoch } from '../../../../../lib/auth/session-epoch';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { notifyOwnerOfRecovery } from '../../../../../lib/notify/notifications';
import { query } from '../../../../../lib/db/connection';

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

      /*
        🔴 RECOVERY USED TO CHANGE THE LOCK AND LEAVE EVERY OLD KEY WORKING,
        SILENTLY. Until 2026-08-14 this branch replaced the authenticator and
        stopped — no session revocation, no audit entry, no word to the owner.
        Recovery is the account-takeover move by construction (a recovery code
        is the one credential that defeats the second factor), and the three
        standard consequences were all absent:

        SESSIONS DIE. bumpSessionEpoch was built for exactly this and had no
        caller. Whoever held a live session — on the lost phone this flow
        exists for, or an attacker's — keeps 24 hours of access to a vault of
        credentials unless the epoch moves. isSessionCurrent compares on every
        request, so this is immediate, not eventual.

        THE CHAIN RECORDS IT. An event that can transfer control of the account
        was invisible to the audit page whose whole promise is "the record
        holds what happened". Written BEFORE the new codes are issued, and
        blocking, per the audit rule — a recovery that cannot be recorded does
        not complete.

        THE OWNER IS TOLD. If the recoverer was not them, this email is the
        only way they learn while it still matters, and it says exactly what to
        do about it. Best-effort — mail must not block the legitimate case.
      */
      await bumpSessionEpoch(userId);
      await writeAuditEntry(userId, {
        actor: `owner:${userId}`,
        action: 'account_recovered',
        entity: 'user',
        entityId: userId,
        detail: { method: 'recovery_code', sessionsRevoked: true },
      });

      // Fresh codes, and the old sheet stops working. After a recovery the
      // previous list is of unknown provenance — it may be why the account
      // needed recovering.
      const codes = await issueRecoveryCodes(userId);

      const who = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [
        userId,
      ]);
      if (who.rows[0]?.email) {
        try {
          await notifyOwnerOfRecovery(who.rows[0].email);
        } catch (err) {
          process.stderr.write(`[recover] owner notice failed: ${String(err)}\n`);
        }
      }

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
