/**
 * OCC (Optimistic Concurrency Control) retry utilities for Aurora DSQL.
 *
 * DSQL uses snapshot isolation; conflicting concurrent writes fail with
 * SQLSTATE 40001 (serialization failure). This module provides:
 *  - OCC_RETRY  — shared retry configuration
 *  - withOccRetry — wraps any async operation with exponential-backoff retry
 *  - isSqlState40001 — predicate that identifies serialization-failure errors
 *
 * Requirements: 5.7, 6.9, 16.3
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const OCC_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 100,
  jitterMs: 50,
  maxDelayMs: 1000,
} as const;

// ---------------------------------------------------------------------------
// Predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when `err` is a PostgreSQL serialization-failure error
 * (SQLSTATE 40001). The `pg` driver surfaces the SQLSTATE code as `err.code`.
 */
export function isSqlState40001(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>).code === '40001'
  );
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

/**
 * Executes `fn` up to `OCC_RETRY.maxAttempts` times.
 *
 * On each failure where `isSqlState40001` is true the wrapper waits
 *   min(baseDelayMs * 2^attempt + jitter, maxDelayMs)
 * before retrying, where `jitter` is a random value in
 * [-jitterMs, +jitterMs].
 *
 * If all attempts are exhausted the last error is re-thrown.
 *
 * The optional `sleepFn` parameter is provided for testability; production
 * code always uses the default `realSleep`.
 */
export async function withOccRetry<T>(
  fn: () => Promise<T>,
  sleepFn: (ms: number) => Promise<void> = realSleep
): Promise<T> {
  const { maxAttempts, baseDelayMs, jitterMs, maxDelayMs } = OCC_RETRY;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isSqlState40001(err)) {
        // Non-serialization error — propagate immediately
        throw err;
      }

      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        // Exhausted all retries — re-throw
        break;
      }

      // Exponential backoff with symmetric jitter
      const jitter = (Math.random() * 2 - 1) * jitterMs; // [-jitterMs, +jitterMs]
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
      await sleepFn(delay);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
