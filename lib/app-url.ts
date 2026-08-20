/**
 * Where this deployment lives. One definition, four former copies.
 *
 * 🔴 THE SAME THREE-LINE EXPRESSION EXISTED IN FOUR PLACES, which is the
 * portfolio rule about cross-boundary contracts being broken quietly: a value
 * read in more than one place gets exactly one authoritative definition, or the
 * copies drift. Found while wiring the billing notices on 2026-08-20, reported
 * rather than fixed in that commit because it was not that item's business.
 *
 *   lib/notify/notifications.ts   every link in every email
 *   lib/people/invite.ts          the claim link handed to a contact
 *   lib/auth/webauthn.ts          the RP ID that passkeys are BOUND to
 *   lib/auth/step-up.ts           whether the elevation cookie is `secure`
 *
 * ⚠️ AND THEY HAD ALREADY STARTED TO DIVERGE. Three were byte-identical. The
 * fourth — step-up — fell back to `''` rather than `'http://localhost:3000'`,
 * because it is not asking the same question: it wants to know whether the
 * origin is https, not what the origin is. The two happen to agree today
 * (`http://localhost:3000` does not start with `https://`, and neither does
 * `''`), so this consolidation is behaviour-preserving — but "happens to agree"
 * is exactly the state that stops being true one edit later.
 *
 * So both questions get a name here, and neither is answered by re-typing the
 * expression.
 *
 * ⚠️ WHY THE FALLBACK CHAIN IS WHAT IT IS, carried from the definition this
 * replaces: NEXT_PUBLIC_SITE_URL is preferred and is set in Vercel production —
 * the same variable drives `metadataBase`, so the canonical origin is stated
 * once. NEXTAUTH_URL stays in the chain so local dev works with no extra setup,
 * and is deliberately NOT repurposed: auth configuration is not something to
 * change as a side effect of fixing an email link.
 *
 * 🔴 CHANGING THIS AFFECTS PASSKEYS. `rpConfig()` derives the WebAuthn relying
 * party id from this origin, and a passkey is bound to the RP id it was
 * registered under — so an origin change does not merely redirect a link, it
 * invalidates every existing credential. That is why this is a named module with
 * a warning rather than an inline expression somebody tidies.
 *
 * Feature: relay-h0-mvp
 */

/** The origin this deployment serves from, with no trailing slash guarantee. */
export function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

/**
 * Is this deployment served over https?
 *
 * The question `step-up.ts` actually asks, so it stops being spelled as a
 * fourth copy of the origin expression with a different fallback. A cookie
 * marked `secure` on a plain-http origin is a cookie the browser will not send,
 * so this must stay false in local development — which it does, because the
 * fallback origin is http.
 */
export function isSecureOrigin(): boolean {
  return appUrl().startsWith('https://');
}
