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
import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';
import { ValidationError } from '../../../../../lib/validation';

/**
 * Ten an hour per address. Far more than a real person needs — they call this
 * once, twice if they fat-finger their email — and slow enough that grinding an
 * address list to learn who uses Relay is not worth anyone's afternoon.
 *
 * The two phases keep separate budgets on purpose. They are one flow to a user,
 * so a shared bucket would mean a few mistyped emails could leave someone
 * unable to finish enrolling the authenticator they had already scanned.
 */
const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

function limited(req: NextRequest, bucket: string): NextResponse | null {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req.headers, bucket), LIMIT, WINDOW_MS);
  if (allowed) return null;
  return NextResponse.json(
    { error: 'RateLimited', message: 'Too many attempts. Please wait and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Before readJson and before beginSignup, deliberately. A limiter that runs
  // after the lookup still answers "does this address have an account?" for
  // every request it then refuses — which is the leak it exists to close.
  const refused = limited(req, 'signup-begin');
  if (refused) return refused;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const { email, displayName } = validateSignupInput(body);
    const { enrolmentToken, otpauthUrl } = await beginSignup(email, displayName);

    // The secret is returned only inside the otpauth URL the QR encodes and
    // inside the signed enrolment token — never as a bare field.
    return NextResponse.json({ enrolmentToken, otpauthUrl }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  // Bounds code guessing against a held enrolment token.
  const refused = limited(req, 'signup-complete');
  if (refused) return refused;

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
