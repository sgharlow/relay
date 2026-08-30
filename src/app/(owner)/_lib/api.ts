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
 *
 * 🔴 IT HAD NO CALLER FOR ITS FIRST DAY, and the change that added it was
 * reported as having given the owner side a door. It had not: this function and
 * its own test were the only two places the name appeared, so the owner 401 was
 * still a sentence with nothing to press — precisely the shape /standby and
 * /helping had been fixed for. The door is `ReadinessBanner`, which renders on
 * every owner screen because it sits in the layout;
 * `_components/signed-out-door.test.ts` fails if this export goes back to having
 * no caller. A helper only its test uses is not a fix, it is a plan.
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

/**
 * Announced after any successful owner-side write.
 *
 * 🔴 WHY THIS EXISTS. `ReadinessBanner` lives in the owner LAYOUT and fetched
 * `/api/readiness` exactly once, on mount. App Router does not remount a layout
 * when navigating between its pages, so the banner kept whatever was true when
 * the owner first arrived — for the rest of the session.
 *
 * Found the first time a real owner did A0 (2026-08-29): the vault page listed
 * "1 item · gmail" directly beneath a banner reading "Your vault is empty", and
 * three minutes later the triggers page still said "Nobody is named to receive
 * access" with the recipient on screen and the trigger ARMED. An owner who
 * trusted it would have concluded nothing had saved.
 *
 * The assessment logic was never wrong — `lib/vault/readiness.ts` queries live
 * counts. It was a right answer from the wrong moment, which is harder to spot
 * than a wrong one.
 *
 * ⚠️ Emitted HERE rather than at each call site, because a convention every
 * future caller must remember is the thing this repo keeps deciding not to rely
 * on. `apiSend` is the single choke point for POST/PUT/DELETE across the owner
 * screens.
 *
 * ⚠️ AND IT IS NOT A COMPLETE CHOKE POINT, which is worth saying plainly rather
 * than discovering later: vault ITEM creation goes through `CryptoService`, not
 * through here, so a same-page item write does not announce. That case is
 * covered instead by the banner re-reading on pathname change — creating an item
 * navigates back to /vault — and closing it properly means emitting from
 * `crypto-service.ts` too. Left undone on purpose: that file is on the crypto
 * path and was not worth touching for a status banner mid-task.
 */
const OWNER_WRITE_EVENT = 'relay:owner-write';
const bus: EventTarget | null = typeof EventTarget === 'undefined' ? null : new EventTarget();

/** Subscribe to owner-side writes. Returns the unsubscribe, for `useEffect`. */
export function onOwnerWrite(handler: () => void): () => void {
  if (!bus) return () => {};
  bus.addEventListener(OWNER_WRITE_EVENT, handler);
  return () => bus.removeEventListener(OWNER_WRITE_EVENT, handler);
}

/** Exported for the test: announcing is a behaviour, not an implementation detail. */
export function announceOwnerWrite(): void {
  bus?.dispatchEvent(new Event(OWNER_WRITE_EVENT));
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

  /*
    AFTER the throws, never before. Announcing a write that failed would refresh
    the banner into showing the same unchanged state, which reads exactly like
    success — the same ordering `setFactorsRequired` already documents for the
    same reason.
  */
  announceOwnerWrite();
  return data as T;
}
