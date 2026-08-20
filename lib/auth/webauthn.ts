/**
 * Passkeys — stage two of the two-stage claim (docs/standby-architecture.md [A1]).
 *
 * WHY THIS IS HAND-ROLLED. next-auth v4 on `strategy: 'jwt'` with no DB adapter
 * has no first-class passkey provider. The two options were to implement WebAuthn
 * directly behind a credentials provider, or move to Auth.js v5; the former keeps
 * the JWT session model the rest of this codebase already reasons about, which is
 * worth more than the ceremony it costs.
 *
 * WHERE THE CHALLENGE LIVES. A WebAuthn ceremony needs a challenge to survive one
 * round trip. This seals it into a short-lived signed JWT (via `jose`, already a
 * dependency) which travels through the client.
 *
 * 🔴 THAT SEAL WAS NOT SINGLE-USE, and this header used to argue it did not need
 * to be: "no new table and therefore no expiry sweep — one scheduler ledger is
 * already carried and a second thing that can silently stop is exactly what the
 * architecture forbids." The cost argument was right. The security argument was
 * a category error: a signature proves WE minted the token and says nothing
 * about whether it has already been spent, so a captured assertion could be
 * replayed for the whole five minutes. Closed 2026-08-15 — the nonce now lives
 * in `auth_challenges` and `openChallenge` BURNS it, so a second presentation of
 * the same seal is refused however valid its signature.
 *
 * And the architectural objection does not survive contact with what was
 * actually added: the sweep is housekeeping, not a guard. Expiry is enforced by
 * a predicate on the read path; if the sweep never runs the table grows and
 * nothing becomes less safe. It rides the heartbeat cron rather than becoming a
 * second scheduled thing that can silently stop. See migration 029.
 *
 * The `purpose` claim is not decoration. Without it, a challenge minted for an
 * authenticated user REGISTERING a passkey could be replayed into the
 * AUTHENTICATION path.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { SignJWT, jwtVerify } from 'jose';
import { appUrl } from '../app-url';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';

import { query } from '../db/connection';
import { ValidationError } from '../validation';
import { newChallengeId, recordChallenge, burnChallenge } from './challenge-store';

export const CHALLENGE_TTL_SECONDS = 300;

/**
 * The two WebAuthn ceremonies. `challenge-store.ts` carries a third (`step-up`)
 * which is not a WebAuthn purpose and must not be sealable through here — this
 * narrower type is what stops a step-up nonce being spent as a passkey
 * challenge or the reverse.
 */
export type ChallengePurpose = 'registration' | 'authentication';

export interface RpConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

/**
 * The relying party is the ORIGIN, and a passkey registered against the wrong RP
 * id is unusable — so this is derived from configuration rather than written down
 * twice. The RP id is the host with no scheme and no port; the origin keeps both,
 * which is what makes `http://localhost:3000` work in development.
 */
export function rpConfig(): RpConfig {
  const raw = appUrl();
  const url = new URL(raw);
  return {
    rpID: url.hostname,
    rpName: 'Relay',
    origin: url.origin,
  };
}

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set');
  return new TextEncoder().encode(s);
}

/**
 * Seals a challenge AND records its nonce as live.
 *
 * The record is written before the token is handed out, and a failure to write
 * it throws rather than returning an unbacked seal — a ceremony whose nonce was
 * never recorded would be refused at the end by `openChallenge`, and telling
 * somebody their perfectly good passkey failed is worse than refusing to start.
 *
 * `userId` is optional because sign-in is deliberately identifier-free: the
 * options endpoint takes no email, looks nothing up, and so has nobody to
 * attribute the nonce to. Registration always knows who is asking.
 */
export async function sealChallenge(
  challenge: string,
  purpose: ChallengePurpose,
  userId?: string,
): Promise<string> {
  const jti = newChallengeId();
  await recordChallenge({ jti, purpose, ttlSeconds: CHALLENGE_TTL_SECONDS, userId });

  return new SignJWT({ challenge, purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(secret());
}

/**
 * Opens a seal and SPENDS it. Throws on a bad signature, an expired seal, a
 * purpose mismatch, or a second presentation of one that has already been used.
 *
 * The burn is what makes a captured assertion worthless: replaying it inside the
 * five-minute window now meets a nonce that is already consumed. Every refusal
 * carries the same message, so a replay and an expiry are indistinguishable to
 * whoever is trying.
 */
export async function openChallenge(sealed: string, purpose: ChallengePurpose): Promise<string> {
  const { payload } = await jwtVerify(sealed, secret());
  if (payload.purpose !== purpose) {
    throw new ValidationError('That challenge was not issued for this step.', 'challenge');
  }
  const challenge = payload.challenge;
  if (typeof challenge !== 'string') {
    throw new ValidationError('Malformed challenge.', 'challenge');
  }

  const { jti } = payload;
  if (typeof jti !== 'string' || !(await burnChallenge(jti, purpose))) {
    throw new ValidationError('That step expired or was already used. Try again.', 'challenge');
  }

  return challenge;
}

// ---------------------------------------------------------------------------
// Storage. base64url TEXT rather than BYTEA — see migration 022 for why.
// ---------------------------------------------------------------------------

interface StoredCredential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  /** BIGINT — node-postgres hands this back as a STRING. Never pass it through raw. */
  counter: string | number;
  transports: string | null;
}

async function findCredential(credentialId: string): Promise<StoredCredential | null> {
  const res = await query<StoredCredential>(
    `SELECT id, user_id, credential_id, public_key, counter, transports
       FROM webauthn_credentials WHERE credential_id = $1 LIMIT 1`,
    [credentialId],
  );
  return res.rows[0] ?? null;
}

export async function listCredentialIdsForUser(userId: string): Promise<string[]> {
  const res = await query<{ credential_id: string }>(
    `SELECT credential_id FROM webauthn_credentials WHERE user_id = $1`,
    [userId],
  );
  return res.rows.map((r) => r.credential_id);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function beginRegistration(user: {
  id: string;
  email: string;
}): Promise<{ options: Awaited<ReturnType<typeof generateRegistrationOptions>>; challenge: string }> {
  const { rpID, rpName } = rpConfig();
  const existing = await listCredentialIdsForUser(user.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    // Excluding what they already have stops a confusing "you already registered
    // this device" dead end.
    excludeCredentials: existing.map((id) => ({ id })),
    authenticatorSelection: {
      // Discoverable so the contact can sign in without typing anything — the
      // whole point of [A1] is that the person who may act once in five years
      // meets as little as possible.
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  return { options, challenge: options.challenge };
}

export async function finishRegistration(args: {
  userId: string;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  label?: string;
}): Promise<{ credentialId: string }> {
  const { rpID, origin } = rpConfig();

  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new ValidationError('That passkey could not be verified.', 'response');
  }

  const { credential } = verification.registrationInfo;

  await query(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, device_label)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      args.userId,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      credential.transports?.join(',') ?? null,
      args.label ?? null,
    ],
  );

  return { credentialId: credential.id };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export async function beginAuthentication(): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challenge: string;
}> {
  const { rpID } = rpConfig();
  // No allowCredentials: discoverable credentials mean the browser offers the
  // right passkey and the user never types an identifier.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  return { options, challenge: options.challenge };
}

export async function finishAuthentication(args: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
}): Promise<{ userId: string }> {
  const { rpID, origin } = rpConfig();

  const stored = await findCredential(args.response.id);
  if (!stored) {
    // Same refusal shape as an unknown account elsewhere in this codebase: it
    // must not tell a stranger which credentials exist.
    throw new ValidationError('That passkey is not recognised.', 'response');
  }

  const verification = await verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64url')),
      // Number(), deliberately: BIGINT arrives as a string and a string counter
      // silently defeats the clone-detection the counter exists for.
      counter: Number(stored.counter),
      transports: (stored.transports?.split(',') as AuthenticatorTransportFuture[]) ?? undefined,
    },
  });

  if (!verification.verified) {
    throw new ValidationError('That passkey could not be verified.', 'response');
  }

  await query(
    `UPDATE webauthn_credentials SET counter = $1, last_used_at = now() WHERE id = $2`,
    [verification.authenticationInfo.newCounter, stored.id],
  );

  return { userId: stored.user_id };
}
