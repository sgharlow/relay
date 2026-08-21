/**
 * Tiny client-side fetch helpers for the owner screens. Surfaces the server's
 * `{ message }` on non-2xx so forms can show inline errors.
 *
 * 🔴 AND, SINCE 2026-08-21, IT TELLS A 401 APART FROM AN OUTAGE. Every owner
 * screen loads through here, and here threw `Failed to load (401)` — so an owner
 * returning to a tab left open past the session read "Could not load your rules:
 * Failed to load (401)" in clay error text, over an empty list, with the
 * readiness banner gone entirely (it renders `null` when it has no data). Nothing
 * on the screen said "sign in again". Pressing Save then produced
 * `Request failed (401)`.
 *
 * The access group already knew this. StandbyClient: "A 401 IS NOT AN OUTAGE, and
 * until 2026-08-13 it was reported as one… a message that says the product is
 * broken, offers no door, and arrives at exactly the moment this page exists
 * for." /standby and /helping were both given a signed-out door; the owner side
 * was not.
 *
 * ⚠️ THE FIX IS AT THE SEAM RATHER THAN ON EACH SCREEN, deliberately. Six clients
 * call these two functions; fixing each one is fixing the ones somebody
 * remembered, which is the recurring shape of the defects in this repo. A screen
 * that only renders `err.message` — which is all of them — now shows the right
 * sentence without being edited, and a screen that wants the whole door can check
 * `instanceof SignedOutError`.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

/**
 * The session ended. Not a failure of anything — the ordinary end of a 24-hour
 * session, or an epoch bump after a password change or a sign-out elsewhere.
 *
 * A distinct type rather than a magic string so a screen can render the full
 * "you are signed out" door, and so a future `catch` cannot mistake it for the
 * server being down and retry into a loop.
 */
export class SignedOutError extends Error {
  readonly status = 401;

  constructor() {
    super(
      'You are signed out — nothing is wrong, and your vault is exactly as you left it. ' +
        'Sign back in to carry on.',
    );
    this.name = 'SignedOutError';
  }
}

/**
 * Where to send somebody so they come back to the page they were on.
 *
 * ⚠️ PATHS ONLY. A callback parameter that accepts an absolute URL is an open
 * redirect, which is how a phishing page borrows a real domain's front door.
 * Anything that is not a single-slash-rooted path is dropped rather than
 * sanitised — a rejected callback costs one navigation, a permissive one costs a
 * credential.
 */
export function signInHref(path: string): string {
  const safe = path.startsWith('/') && !path.startsWith('//');
  return safe ? `/auth/signin?callbackUrl=${encodeURIComponent(path)}` : '/auth/signin';
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok) throw new Error(`Failed to load (${res.status})`);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  /*
    Checked BEFORE the body is preferred. `/api/*` answers a 401 with
    `{ error: 'Unauthorized' }` and sometimes `{ message: 'Unauthorized' }` —
    developer vocabulary, and preferring it here would have put that word back on
    the screen while every other assertion in api.test.ts still passed.
  */
  if (res.status === 401) throw new SignedOutError();
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data as T;
}
