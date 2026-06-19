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
import { query } from '../db/connection';
import { validateTotpCode } from './totp';

// ---------------------------------------------------------------------------
// DB upsert — auth_sub → users.id mapping
// ---------------------------------------------------------------------------

interface UserRecord {
  id: string;
  email: string;
  is_demo_account: boolean;
}

/**
 * Upserts the user identified by `authSub` into the `users` table.
 * On first sign-in a new row is created with defaults.
 * On subsequent sign-ins the email column is kept in sync.
 *
 * Returns the resolved {id, is_demo_account} for the caller.
 */
async function upsertUser(authSub: string, email: string): Promise<UserRecord> {
  const result = await query<UserRecord>(
    `
    INSERT INTO users (email, auth_sub, status, last_active_at, checkin_interval_days, is_demo_account)
    VALUES ($1, $2, 'active', now(), 30, false)
    ON CONFLICT (auth_sub) DO UPDATE
      SET email = EXCLUDED.email,
          last_active_at = now()
    RETURNING id, email, is_demo_account
    `,
    [email, authSub],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Upsert returned no rows');
  return row;
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
      async authorize(credentials): Promise<User | null> {
        if (!credentials?.email || !credentials?.totpCode) {
          return null; // Missing credentials → reject
        }

        const email = credentials.email.trim().toLowerCase();
        const totpCode = credentials.totpCode.trim();

        // --- MFA gate (Requirement 17.1) ---
        const totpValid = validateTotpCode(totpCode);
        if (!totpValid) {
          // TOTP factor invalid — reject session
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
