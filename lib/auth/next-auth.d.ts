/**
 * NextAuth.js type augmentations.
 *
 * Extends the built-in Session and JWT types with Relay-specific fields so
 * TypeScript knows that getServerSession() returns {ownerId, isDemo}.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import type { DefaultSession, DefaultJWT } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    /** UUID of the authenticated owner in the `users` table. */
    ownerId: string;
    /** True when this account is flagged as a demo account (is_demo_account). */
    isDemo: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    ownerId?: string;
    isDemo?: boolean;
  }
}
