/**
 * POST /api/auth/signup — begin enrolment (email → otpauth URL + enrolment token)
 * PUT  /api/auth/signup — complete enrolment (token + code → active account)
 *
 * No account exists between the two calls: `beginSignup` writes nothing, so an
 * abandoned enrolment leaves no row and no MFA-less account (Req 17.1).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R3, 17.1
 */

import { NextResponse, type NextRequest } from 'next/server';

import { readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { validateSignupInput, beginSignup, completeSignup } from '../../../../../lib/auth/signup';
import { ValidationError } from '../../../../../lib/validation';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const { email } = validateSignupInput(body);
    const { enrolmentToken, otpauthUrl } = await beginSignup(email);

    // The secret is returned only inside the otpauth URL the QR encodes and
    // inside the signed enrolment token — never as a bare field.
    return NextResponse.json({ enrolmentToken, otpauthUrl }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { enrolmentToken, code } = (body ?? {}) as {
    enrolmentToken?: unknown;
    code?: unknown;
  };

  try {
    if (typeof enrolmentToken !== 'string' || typeof code !== 'string') {
      throw new ValidationError('enrolmentToken and code are required');
    }
    return NextResponse.json(await completeSignup(enrolmentToken, code));
  } catch (err) {
    return mapError(err);
  }
}
