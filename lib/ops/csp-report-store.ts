/**
 * Where CSP violation reports go, so the evidence outlives the log.
 *
 * 🔴 THE FINDING THIS CLOSES. `/api/csp-report` wrote to stderr and nowhere
 * else. Vercel runtime log retention measured ~24 hours on 2026-08-20 (a 7-day
 * query and a 24-hour query returned identical counts), so the report-only
 * policy's stated plan — "observe real traffic, then take the middleware
 * decision on evidence" — could never execute. The evidence expired before
 * anybody read it.
 *
 * ⚠️ THIS MODULE MUST NEVER MAKE A PAGE WORSE. It is called from a reporting
 * endpoint, by a browser that has just had something blocked, on a page a person
 * is looking at, and the response is discarded. Every failure path here is
 * swallowed: a missing table latches to stderr once, and anything else is
 * absorbed silently. There is no error worth turning into a second error.
 *
 * The stderr line is KEPT rather than replaced. It costs nothing, it is what
 * works before migration 038 reaches a cluster, and a tail is still the fastest
 * way to watch a policy change land in real time.
 *
 * Feature: relay-h0-mvp
 */

import { query } from '../db/connection';

/** Postgres/DSQL SQLSTATE for `relation does not exist`. */
const UNDEFINED_TABLE = '42P01';

/**
 * Set once when the table turns out not to exist, so a cluster without migration
 * 038 costs one failed query per process rather than one per report.
 *
 * ⚠️ Deliberately NOT reset on success and NOT time-based, for the same reason
 * `signin-attempts.ts` gives: a broken page can emit many reports per second, and
 * retrying the write for every one of them turns a missing migration into
 * sustained load at precisely the moment something is already wrong.
 */
let relationMissing = false;

/** Test seam. */
export function _resetCspStoreForTesting(): void {
  relationMissing = false;
}

/** Exported so a test can assert the latch tripped rather than inferring it. */
export function _cspStoreUnavailable(): boolean {
  return relationMissing;
}

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

export interface CspViolation {
  /** 'enforce' — actually blocked. 'report' — the stricter policy would have. */
  disposition: string | null;
  directive: string | null;
  blocked: string | null;
  /** Path only; the caller strips the query string. */
  document: string | null;
}

/**
 * Record one violation. Resolves regardless of what goes wrong.
 *
 * Returns whether a row was written, which is for tests and callers that want to
 * log differently — never for control flow that could reach the browser.
 */
export async function recordCspViolation(v: CspViolation): Promise<boolean> {
  if (relationMissing) return false;

  try {
    await query(
      `INSERT INTO csp_reports (disposition, directive, blocked, document)
       VALUES ($1, $2, $3, $4)`,
      [v.disposition, v.directive, v.blocked, v.document],
    );
    return true;
  } catch (err) {
    if (isUndefinedTable(err)) {
      relationMissing = true;
      try {
        process.stderr.write(
          '[csp] csp_reports is absent — migration 038 has not reached this cluster. ' +
            'Reports continue to stderr only; the durable window starts when it is applied.\n',
        );
      } catch {
        /* a broken stderr must not escalate */
      }
    }
    /*
      Everything else — a timeout, a connection reset, a permission denial — is
      absorbed without a word. One line per report during a DSQL wobble would
      bury the log at the moment somebody needs to read it, and this endpoint can
      be called in a tight loop by a single broken page.
    */
    return false;
  }
}
