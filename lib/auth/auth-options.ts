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
import { query } from '../db/connection';

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
      async authorize(credentials): Promise<User | null> {
        if (!credentials?.email || !credentials?.totpCode) {
          return null; // Missing credentials → reject
        }

        const email = credentials.email.trim().toLowerCase();
        const totpCode = credentials.totpCode.trim();

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
          // A lookup failure is ours, not the caller's. Log it; say nothing.
          console.error('[auth] TOTP secret lookup failed:', err);
          return null;
        }

        if (!totpSecret || !validateTotpCodeFor(totpSecret, totpCode)) {
          return null;
        }

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
      }
      return session;
    },
  },

  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};
