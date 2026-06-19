/**
 * NextAuth.js v4 catch-all route handler.
 *
 * Delegates all /api/auth/* requests to NextAuth using the shared authOptions
 * configuration (email + TOTP credentials provider, JWT session strategy).
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import NextAuth from 'next-auth';
import { authOptions } from '../../../../../lib/auth/auth-options';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
