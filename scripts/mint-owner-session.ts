/**
 * Mint an owner session cookie for local audit tooling. READ-ONLY on the DB.
 *
 * Local development only — it needs NEXTAUTH_SECRET, which only exists in
 * .env.local and in Vercel's environment. It exists because the demo owner's
 * second factor is a real authenticator: `generateTotpCode()` cannot produce a
 * code for it on a machine whose env secret is shorter than otplib's 16-byte
 * floor, so scripting the sign-in FORM is not possible. Forging the session is
 * the alternative to mutating the account's auth state to audit it.
 *
 * Used by scripts/a11y-audit.mjs.
 */
import { encode } from 'next-auth/jwt';
import { query, closeAllPools } from '../lib/db/connection';
import { readSessionEpoch } from '../lib/auth/session-epoch';

async function main(): Promise<void> {
  const email = process.argv[2] ?? 'demo@relay.test';
  const r = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE email = $1`,
    [email],
  );
  if (!r.rows.length) throw new Error(`no such user: ${email}`);
  const u = r.rows[0];
  const epoch = (await readSessionEpoch(u.id)) ?? 0;
  const token = await encode({
    token: { sub: u.id, email: u.email, ownerId: u.id, isDemo: false, sessionEpoch: epoch },
    secret: process.env.NEXTAUTH_SECRET as string,
  });
  console.log('COOKIE ' + token);
  await closeAllPools();
}
main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
