/**
 * Next's global server-error hook.
 *
 * This is the piece the canary could never be. The canary asserts behaviour on
 * routes it was written to exercise; this fires for any server error on any
 * route, including the ones nobody anticipated — which, on an open beta driven
 * by ads, is most of them.
 *
 * `onRequestError` did not exist in Next 14. It became available with the
 * upgrade to 16, and this is the first thing built on it.
 *
 * ⚠️ THIS FILE IS BUNDLED FOR BOTH RUNTIMES. Next compiles instrumentation for
 * Edge as well as Node, so a top-level import of the reporter drags Resend and
 * `process.stderr` into an Edge bundle that supports neither, and the build
 * reports it against this file. The import is therefore dynamic and guarded on
 * NEXT_RUNTIME. Relay's routes all run on Node, so nothing is lost.
 *
 * Everything hard (redaction, rate limiting, never throwing) lives in
 * lib/ops/error-reporter.ts, so the reporting logic stays testable without a
 * running server.
 *
 * Feature: relay-h0-mvp (CC9)
 */

export async function onRequestError(
  err: unknown,
  request: { path?: string },
  context?: { routePath?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { reportServerError } = await import('../lib/ops/error-reporter');

  // routePath is the pattern (/api/vault/[id]); path is what was requested.
  // The pattern groups better for deduplication, so prefer it when present.
  await reportServerError(err, {
    path: context?.routePath ?? request?.path,
    digest: (err as { digest?: string })?.digest,
  });
}
