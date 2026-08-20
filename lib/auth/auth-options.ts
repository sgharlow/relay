/**
 * NextAuth.js v4 configuration with Credentials provider enforcing TOTP MFA.
 *
 * Flow:
 *  1. User submits {email, totpCode} via the Credentials provider form.
 *  2. `authorize` validates the TOTP code via lib/auth/totp.ts.
 *  3. On success: upserts a row in `users` keyed by `auth_sub` (= email for
 *     credentials-based auth) and returns {id, email, ownerId, isDemo}.
 *  4. The `jwt` callback attaches ownerId + isDemo to the JWT token.
 *  5. The `session` callback copies those fields onto the session object.
 *  6. `getOwnerSession()` in lib/auth/session.ts reads the enriched session.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import type { NextAuthOptions, User } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { validateTotpCodeFor } from './totp';
import { resolveTotpSecret } from './resolve-totp-secret';
import { upsertUser, type UserRecord } from './upsert-user';
import { openChallenge, finishAuthentication } from './webauthn';
import { claimStandbyRole } from '../people/claim';
import { redeemBreakGlass } from '../people/break-glass';
import { readSessionEpoch } from './session-epoch';
import { query } from '../db/connection';
import {
  checkSigninAllowed,
  recordSigninFailure,
  clearSigninFailures,
} from './signin-throttle';
import { recordCodeMiss } from '../ops/guess-watch';

/**
 * The client address NextAuth hands `authorize`, or null.
 *
 * NextAuth v4 passes a plain header BAG rather than a `Headers` instance, so
 * `lib/http/rate-limit`'s `clientKey` — which calls `.get()` — cannot be reused
 * here. Same rule, spelled for this shape: the left-most `x-forwarded-for` entry
 * is the client, and an unidentifiable caller returns null so the throttle can
 * bucket it conservatively rather than exempt it.
 */
function sourceAddress(headers: Record<string, unknown> | undefined): string | null {
  const raw = headers?.['x-forwarded-for'] ?? headers?.['x-real-ip'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const first = value.split(',')[0]?.trim();
  return first ? first : null;
}

// ---------------------------------------------------------------------------
// Extend next-auth types
// ---------------------------------------------------------------------------

// Augment the JWT and Session types so TypeScript knows about our custom fields.
// The actual module augmentation lives in lib/auth/next-auth.d.ts (created below).

// ---------------------------------------------------------------------------
// AuthOptions
// ---------------------------------------------------------------------------

export const authOptions: NextAuthOptions = {
  // Use JWT strategy — no DB adapter required; session data lives in the cookie.
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },

  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,

  providers: [
    CredentialsProvider({
      id: 'email-totp',
      name: 'Email + TOTP',
      credentials: {
        email: {
          label: 'Email address',
          type: 'email',
          placeholder: 'owner@example.com',
        },
        totpCode: {
          label: 'Authenticator code',
          type: 'text',
          placeholder: '000000',
        },
      },

      /**
       * Authorize is the MFA enforcement gate.
       *
       * Returns a User object (causing NextAuth to proceed) or null (reject).
       * Per Requirement 17.1: sessions without a valid TOTP factor are rejected.
       */
      async authorize(credentials, req): Promise<User | null> {
        if (!credentials?.email || !credentials?.totpCode) {
          return null; // Missing credentials → reject
        }

        const email = credentials.email.trim().toLowerCase();
        const totpCode = credentials.totpCode.trim();

        /*
          --- ATTEMPT BUDGET (lib/auth/signin-throttle.ts) ---

          There is no password on this door: an address and six digits are the
          whole of it, and three of a million codes are valid at any instant.
          Until 2026-08-20 nothing here counted a failure or refused a caller,
          so a stranger who knew an owner's address could walk the keyspace
          unattended in hours against the account that decrypts a vault.

          CHECKED BEFORE THE LOOKUP, on purpose. `resolveTotpSecret` is a DSQL
          query, so a refused attempt must cost nothing — an unbudgeted door is
          an amplifier against the database as well as a way in.

          ⚠️ A REFUSAL RETURNS THE SAME `null` AS EVERY OTHER FAILURE. The
          comment below already establishes why an unknown address, a wrong code
          and an undecodable secret must be indistinguishable from outside;
          answering "too many attempts" would confirm that an address holds a
          Relay account and rebuild the enumeration oracle from the other side.
          The reason is logged for the server and never returned.
        */
        const gate = checkSigninAllowed(email, sourceAddress(req?.headers));
        if (!gate.allowed) {
          console.warn(`[auth] sign-in refused by ${gate.refusedBy} budget`);
          return null;
        }

        // --- MFA gate (Requirement 17.1) ---
        // Resolve THIS owner's secret. A shared secret would let any user mint a
        // valid second factor for any other account.
        //
        // Every failure below returns the same `null`, and therefore the same
        // CredentialsSignin response. An unknown address, a known address with
        // the wrong code, and an account whose secret cannot be decoded are
        // indistinguishable from outside — which is the point: answering them
        // differently tells a stranger which emails hold a Relay account.
        let totpSecret: string | null;
        try {
          totpSecret = await resolveTotpSecret(email);
        } catch (err) {
          /*
            A lookup failure is OURS, not the caller's — so it is the one
            failure that must NOT spend the caller's budget. Charging somebody
            for our database being unreachable would turn a DSQL blip into a
            lockout of every owner who tried during it, which is the failure
            mode this whole module is written to avoid causing.
          */
          console.error('[auth] TOTP secret lookup failed:', err);
          return null;
        }

        if (!totpSecret || !validateTotpCodeFor(totpSecret, totpCode)) {
          /*
            Both halves count, and they are recorded together because they are
            two different questions.

            The BUDGET closes the door on this address. The MISS tells somebody
            it is happening — lib/ops/guess-watch.ts exists because "a guess at
            a code that does not exist left no trace at all", and until now the
            shortest secret in the product was the one kind it did not count. A
            limiter without an alarm hides the attack it deflects: the attacker
            simply slows down, and nobody ever learns they were there.

            An unknown address and a wrong code both land here on purpose. From
            outside they are the same event, and separating them here is how the
            uniform `null` gets undone from the inside.
          */
          recordSigninFailure(email);
          await recordCodeMiss('totp');
          return null;
        }

        /*
          The code was right, so the budget starts again from zero — this is
          what makes it a FAILURE budget rather than a rate limit. Somebody who
          fumbled four codes and then got one right is not carrying those four
          into their next bad day, while an attacker, who by definition never
          reaches this line, never gets the reset.

          Cleared HERE rather than after the upsert, so a database failure on
          the next line — which is ours, not theirs — cannot leave a proven
          owner holding a spent budget.
        */
        clearSigninFailures(email);

        // --- auth_sub → users.id upsert ---
        // For credentials-based auth the auth_sub is the email address.
        const authSub = `credentials:${email}`;

        let userRecord: UserRecord;
        try {
          userRecord = await upsertUser(authSub, email);
        } catch (err) {
          console.error('[auth] DB upsert failed:', err);
          return null; // DB error — fail closed
        }

        // Return User shape that NextAuth stores in the JWT
        return {
          id: userRecord.id,
          email: userRecord.email,
          // Extra fields attached via jwt callback below
          ownerId: userRecord.id,
          isDemo: userRecord.is_demo_account,
        } as User & { ownerId: string; isDemo: boolean };
      },
    }),

    /**
     * Claim a standby role AND get a session in one step — [A1] stage one,
     * "acknowledge and bind this device".
     *
     * WHY THIS IS A PROVIDER RATHER THAN A REST CALL. A freshly-claimed contact
     * has no TOTP secret and no passkey, so binding their identity in the
     * database and stopping there leaves them with an account they can never sign
     * into. The bind IS the session: redeeming the code is the one-time
     * authentication, and the session cookie it mints is the device binding the
     * architecture is describing.
     *
     * A passkey (stage two) is offered afterwards and is deferrable. Until they
     * add one, this session is what they have — which is why it is worth nothing
     * more than the single-use code that produced it.
     *
     * `existingUserId` is passed by the caller when someone is already signed in,
     * so a second relationship LINKS rather than minting a second account
     * (§3.7 rule 2).
     */
    CredentialsProvider({
      id: 'standby-claim',
      name: 'Standby claim',
      credentials: {
        token: { label: 'Code', type: 'text' },
        existingUserId: { label: 'Existing user', type: 'text' },
      },

      async authorize(credentials): Promise<User | null> {
        if (!credentials?.token) return null;

        try {
          const claim = await claimStandbyRole({
            token: credentials.token,
            existingUserId: credentials.existingUserId || undefined,
          });

          const rec = await query<{ id: string; email: string; is_demo_account: boolean }>(
            `SELECT id, email, is_demo_account FROM users WHERE id = $1 LIMIT 1`,
            [claim.userId],
          );
          const user = rec.rows[0];
          if (!user) return null;

          return {
            id: user.id,
            email: user.email,
            ownerId: user.id,
            isDemo: user.is_demo_account,
          } as User & { ownerId: string; isDemo: boolean };
        } catch (err) {
          // Unknown, expired and already-used all arrive here and all return the
          // same null, so which it was does not leak.
          console.error('[auth] standby claim rejected:', err);
          return null;
        }
      },
    }),

    /**
     * Break-glass — the way back in when every normal path is gone (§3.6).
     *
     * Two people need it: the contact who never claimed, and the contact whose
     * authenticator is in a river. Without it the first is excluded from the
     * circle entirely and the second must reach the owner — who may be precisely
     * the person who cannot be reached.
     *
     * A credentials provider for the same reason `standby-claim` is one: the code
     * IS the authentication, exactly once, and everything after it needs to be an
     * ordinary session so that /standby, /access and /verify all simply work.
     *
     * NO SEPARATE RATE LIMIT, deliberately, matching `standby-claim`. The code is
     * twelve characters from a 31-character alphabet (~59 bits), so guessing is
     * not the attack; the per-code attempt budget in `redeemBreakGlass` bounds
     * repetition against a code that is known-but-spent, and `lib/http/rate-limit`
     * is per-instance memory that its own header says is not a security boundary.
     * Adding it here would be theatre.
     */
    CredentialsProvider({
      id: 'break-glass',
      name: 'Emergency code',
      credentials: {
        code: { label: 'Emergency code', type: 'text' },
        existingUserId: { label: 'Existing user', type: 'text' },
      },

      async authorize(credentials): Promise<User | null> {
        if (!credentials?.code) return null;

        try {
          const redeemed = await redeemBreakGlass({
            code: credentials.code,
            existingUserId: credentials.existingUserId || undefined,
          });

          const rec = await query<{ id: string; email: string; is_demo_account: boolean }>(
            `SELECT id, email, is_demo_account FROM users WHERE id = $1 LIMIT 1`,
            [redeemed.userId],
          );
          const user = rec.rows[0];
          if (!user) return null;

          return {
            id: user.id,
            email: user.email,
            ownerId: user.id,
            isDemo: user.is_demo_account,
          } as User & { ownerId: string; isDemo: boolean };
        } catch (err) {
          // Unknown, expired, spent, and belonging-to-a-revoked-person all arrive
          // here and all return the same null. Telling them apart would let
          // someone probe which codes were ever real.
          console.error('[auth] break-glass rejected:', err);
          return null;
        }
      },
    }),

    /**
     * Passkey sign-in — stage two of the claim, and the only path a standby
     * contact has onto a NEW device without the owner reissuing anything.
     *
     * It is a credentials provider because next-auth v4 on a JWT session with no
     * adapter has no first-class passkey provider; the cryptography happens in
     * lib/auth/webauthn.ts and this is only the bridge to a session.
     *
     * The sealed challenge travels through the client, which is safe because it
     * is signed, expires in five minutes, and carries a purpose claim — a
     * registration challenge cannot be spent here.
     *
     * NO TOTP, and that is the point. TOTP is owner-grade friction, correct for
     * someone protecting a vault and wrong for a contact who may act once in five
     * years. A passkey is a stronger factor than a shared secret anyway: it is
     * phishing-resistant by construction, which is what makes "Relay never sends
     * a link that signs you in" architectural rather than aspirational.
     */
    CredentialsProvider({
      id: 'passkey',
      name: 'Passkey',
      credentials: {
        response: { label: 'Assertion', type: 'text' },
        challengeToken: { label: 'Challenge', type: 'text' },
      },

      async authorize(credentials): Promise<User | null> {
        if (!credentials?.response || !credentials?.challengeToken) return null;

        try {
          const expectedChallenge = await openChallenge(
            credentials.challengeToken,
            'authentication',
          );
          const parsed = JSON.parse(credentials.response);
          const { userId } = await finishAuthentication({
            response: parsed,
            expectedChallenge,
          });

          const rec = await query<{ id: string; email: string; is_demo_account: boolean }>(
            `SELECT id, email, is_demo_account FROM users WHERE id = $1 LIMIT 1`,
            [userId],
          );
          const user = rec.rows[0];
          if (!user) return null;

          return {
            id: user.id,
            email: user.email,
            ownerId: user.id,
            isDemo: user.is_demo_account,
          } as User & { ownerId: string; isDemo: boolean };
        } catch (err) {
          // Every failure returns the same null, so an expired challenge, an
          // unknown credential and a bad signature are indistinguishable from
          // outside — the same discipline the TOTP path above already keeps.
          console.error('[auth] passkey assertion rejected:', err);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    /**
     * Persist ownerId and isDemo in the JWT so they survive server restarts.
     * The token is signed with NEXTAUTH_SECRET and stored in a httpOnly cookie.
     */
    async jwt({ token, user }) {
      if (user) {
        // First sign-in — copy from the User object returned by authorize
        const u = user as User & { ownerId: string; isDemo: boolean };
        token.ownerId = u.ownerId;
        token.isDemo = u.isDemo;
        token.sub = u.id;
        // Stamped once, at sign-in. Compared against the row on every request,
        // which is what makes revocation immediate rather than "within 24 hours".
        token.sessionEpoch = (await readSessionEpoch(u.ownerId)) ?? 0;
      }
      return token;
    },

    /**
     * Expose ownerId and isDemo on the session object that client components
     * receive via useSession() or getServerSession().
     */
    async session({ session, token }) {
      if (token.ownerId) {
        session.user = session.user ?? {};
        (session as Record<string, unknown> & typeof session).ownerId =
          token.ownerId as string;
        (session as Record<string, unknown> & typeof session).isDemo =
          (token.isDemo as boolean) ?? false;
        (session as Record<string, unknown> & typeof session).sessionEpoch =
          token.sessionEpoch as number | undefined;
      }
      return session;
    },
  },

  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};
