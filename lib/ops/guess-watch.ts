/**
 * Noticing that somebody is guessing codes.
 *
 * 🔴 A GUESS AT A CODE THAT DOES NOT EXIST LEFT NO TRACE AT ALL. Every guessable
 * credential carries a `failed_attempts` budget on its own row, and
 * `recordFailedAttempt` increments it — `WHERE code_hash = $1`. That only ever
 * matches when the guesser was already right about which code exists. A walk
 * through the keyspace, which is what an actual attack looks like, incremented
 * nothing, wrote nothing, and alerted nobody.
 *
 * lib/auth/code-entropy.test.ts already proves the codes are long enough that
 * this is not exploitable today: 31^8 is 2^39.6 for the short ones and 2^49.5
 * for a recovery code. That reasoning is sound and this does not replace it.
 *
 * ⚠️ BOTH PARAGRAPHS ABOVE DESCRIBE CODES ONLY, and on 2026-08-20 a fifth kind
 * arrived that fits neither. `totp` has no row, so there is no `failed_attempts`
 * to increment and EVERY failure is a miss of the kind this module counts; and
 * the entropy argument does not carry, because six digits is not thirty-one to
 * the eighth. Its budget lives in lib/auth/signin-throttle.ts and its severity
 * is written separately — see `severityParagraph` below, which exists because
 * the alert text under these paragraphs would otherwise have reassured a reader
 * about the one credential worth being alarmed about.
 *
 * WHAT WAS MISSING IS NOT ENTROPY, IT IS EVIDENCE. Every defence here is
 * preventive, and none of them would tell anyone it was being tested. The first
 * thing you want when a credential scheme is under attack is to know — before
 * the arithmetic stops being comfortable, before somebody shortens a constant
 * "for usability", and while there is still a choice about what to do.
 *
 * DELIBERATELY IN MEMORY, AND DELIBERATELY NOT A CONTROL. It counts per
 * instance, so a distributed attempt is under-counted; it refuses nothing and
 * blocks nobody. Making it a boundary would need shared state, and
 * lib/http/rate-limit.ts already explains why that infrastructure is not worth
 * adding for this. A partial signal that fires late is worth a great deal more
 * than the nothing that was here — and unlike a limiter, under-counting makes
 * it quieter rather than wrong.
 *
 * Feature: relay-h0-mvp
 */

import { opsAlertAddress } from './alert-address';
import { sendEmailBestEffort } from '../notify/email';

/**
 * What was being guessed. Only ever a fixed label — never the code itself.
 *
 * 🔴 `totp` WAS MISSING, added 2026-08-20, and its absence was the sharper half
 * of the same defect this module was written for. The four kinds below are all
 * long codes whose entropy makes guessing uninteresting; the one that was NOT
 * here is the SHORTEST secret in the product — six digits, three of them valid
 * at any instant against the ±1-step skew window — and it stands on the owner's
 * front door with a decrypted vault behind it. So the credential most worth
 * guessing was the one credential a guess against which left no trace at all.
 *
 * A miss here means a code that matched nothing. For `totp` that is the only
 * kind of miss there is: unlike the code kinds, there is no row to burn an
 * attempt against, which is why the budget for it lives in
 * lib/auth/signin-throttle.ts instead.
 */
export type GuessKind = 'recipient' | 'verifier' | 'invitation' | 'recovery' | 'totp';

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Misses in one window before anybody is told.
 *
 * A real person mistypes a code once or twice and gives up; forty misses across
 * the whole product in fifteen minutes is not fumbling. Set high enough that a
 * family passing a code around on a bad phone line never trips it, because an
 * alert people learn to ignore is worse than no alert.
 */
export const ALERT_THRESHOLD = 40;

/** One alert per window at most, however loud it gets. */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

interface Window {
  count: number;
  resetAt: number;
  byKind: Record<string, number>;
}

let window: Window | null = null;
let lastAlertAt = 0;

/** Test seam. */
export function _resetGuessWatchForTesting(): void {
  window = null;
  lastAlertAt = 0;
}

/** Current window count — exported for the test, not for a caller to gate on. */
export function missesInWindow(now: number = Date.now()): number {
  return window && now < window.resetAt ? window.count : 0;
}

/**
 * How alarmed the reader should be, decided by WHICH credential was missed.
 *
 * 🔴 THIS EXISTS BECAUSE THE OLD COPY WOULD HAVE BECOME A LIE THE DAY `totp`
 * WAS ADDED. It read, unconditionally: "Nothing is currently at risk from
 * guessing alone (the short codes carry 2^39.6, recovery codes 2^49.5), so this
 * is a prompt to look, not an incident." That sentence is true of the four code
 * kinds and false of a six-digit authenticator code, which carries about 2^20
 * with three values valid at once. An alert that reassures the reader at
 * exactly the moment the arithmetic stops being comfortable is worse than no
 * alert — it is the alert doing the attacker's work.
 *
 * Exported so the test can assert both branches by their content rather than by
 * their existence.
 */
export function severityParagraph(byKind: Record<string, number>): string {
  const totp = byKind.totp ?? 0;

  if (totp > 0) {
    return (
      `${totp} of these were AUTHENTICATOR CODES on the owner sign-in path, and ` +
      'that is the one to read first. A six-digit code with a one-step skew ' +
      'window is three valid values in a million — orders of magnitude weaker ' +
      'than any other credential counted here — and behind it is an owner ' +
      'session that can decrypt a vault.\n\n' +
      'A per-address failure budget bounds this (lib/auth/signin-throttle.ts), ' +
      'but it lives in per-instance memory, so a distributed attempt is ' +
      'under-counted by both the budget and this counter. Treat a sustained ' +
      'run of these as an incident rather than as a prompt to look, and check ' +
      'whether one address is being worked or many are being sprayed.'
    );
  }

  return (
    'This counter is per-instance and refuses nothing — it is a signal, not a ' +
    'control. Nothing is currently at risk from guessing alone (the short codes ' +
    'carry 2^39.6, recovery codes 2^49.5), so this is a prompt to look, not an ' +
    'incident.'
  );
}

/**
 * Records one guess that matched NOTHING.
 *
 * ⚠️ NEVER PASS THE CODE. This takes a `kind` and nothing else, on purpose: an
 * alert that quotes the attempted value turns the ops mailbox into a list of
 * near-miss credentials, and a near miss against an 8-character code is a
 * meaningful head start. Callers that have the code in hand must not hand it
 * over — the signature is the enforcement.
 */
export async function recordCodeMiss(kind: GuessKind, now: number = Date.now()): Promise<void> {
  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + WINDOW_MS, byKind: {} };
  }
  window.count += 1;
  window.byKind[kind] = (window.byKind[kind] ?? 0) + 1;

  if (window.count < ALERT_THRESHOLD) return;
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;

  const breakdown = Object.entries(window.byKind)
    .map(([k, n]) => `${k}: ${n}`)
    .join(', ');

  try {
    process.stderr.write(`[guess-watch] ${window.count} code misses in 15m — ${breakdown}\n`);
  } catch {
    /* a broken stderr must not escalate */
  }

  /*
    Same address resolution as the error reporter, including its fallback, so
    this cannot be the one alert that is silently unaddressed. The alert is
    best-effort by design: failing to send must never fail the request that a
    real person is waiting on.
  */
  const to = opsAlertAddress({ fallbackToReplyTo: true });
  if (!to) return;

  await sendEmailBestEffort({
    to,
    subject: `Relay — ${window.count} failed code attempts in 15 minutes`,
    text:
      `${window.count} attempts matched no code at all in the last 15 minutes.\n` +
      `Breakdown: ${breakdown}\n\n` +
      'A miss against a code that does not exist is what a keyspace walk looks ' +
      'like; a person mistyping their own code hits an EXISTING row and burns ' +
      'its attempt budget instead.\n\n' +
      severityParagraph(window.byKind) +
      '\n\nNo attempted code is included here, deliberately: a near miss against an ' +
      '8-character code would be a head start.\n',
  });
}
