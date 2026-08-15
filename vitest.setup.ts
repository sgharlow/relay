/**
 * What environment the suite believes it is running in.
 *
 * Two behaviours are now gated on the environment rather than on configuration
 * alone — operational alerts (`lib/ops/alert-address.ts`) and outbound mail
 * (`lib/notify/email.ts`) — because in this repo `.env.local` is a full
 * production env file and "nothing is configured here" was never a guard. Both
 * refuse to act outside production.
 *
 * Under vitest `NODE_ENV` is `'test'`, which is positively not production, so
 * without this every test that exercises a send would assert on the refusal
 * instead of on the behaviour it was written for. That is the correct runtime
 * answer and the wrong test default: these suites are describing what the
 * PRODUCTION system does.
 *
 * So the default is declared once, here, rather than pasted into every file
 * that happens to send something. A test that wants a different environment
 * overrides it with `vi.stubEnv('VERCEL_ENV', …)` and `vi.unstubAllEnvs()`,
 * which is exactly what the guards' own tests do.
 *
 * ⚠️ THIS IS A TEST DEFAULT, NOT A PRODUCTION ONE. Nothing here changes how the
 * guards behave when the app runs; it states which environment the assertions
 * are about. The guards are proven to refuse in `email.test.ts` and
 * `alert-address.test.ts`, both of which stub their way back out of this.
 */

process.env.VERCEL_ENV ??= 'production';
