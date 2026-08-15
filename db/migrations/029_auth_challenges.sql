-- Single-use authentication challenges.
--
-- ⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT USES IT. Not a preference — an
-- ordering requirement with teeth. `sealChallenge()` records a nonce before it
-- hands out a token, and it THROWS if that write fails rather than returning an
-- unbacked seal. Deploy the code against a cluster without this table and
-- passkey registration and passkey sign-in both stop working, loudly.
--
-- That direction is the deliberate one: the alternative is falling back to the
-- stateless seal, which would silently turn replay protection off and look
-- exactly like everything working. Loud beats silent. But it means the order is
-- not optional.
--
--     npx tsx --env-file=.env.local db/migrations/migrate.ts 029_auth_challenges.sql
--
-- Additive and safe to run ahead of the deploy: CREATE TABLE IF NOT EXISTS,
-- nothing reads it until the new code ships, no existing table is touched.
-- `migrate.ts` applies ONE named file and silently applies 001 if called bare —
-- pass the filename.
--
-- TWO DEFERRED SECURITY ITEMS SHARE THIS TABLE (PROJECT.yaml `deferred:`,
-- opened 2026-08-14 by the six-lens audit, closed here):
--
--   webauthn-challenge-single-use — a passkey challenge was a stateless signed
--     token valid ~5 minutes and NOT burned on use, so a captured assertion
--     could be replayed inside that window. Its own header argued the seal
--     needed "no new table and therefore no expiry sweep". That reasoning was
--     right about the cost and wrong about the guarantee: a signed token proves
--     WE minted it, never that it has not already been spent. Only a server-side
--     record can say "once".
--
--   step-up-reauth-on-sensitive-actions — issuing recovery codes, exporting the
--     vault and closing the account ran on the ordinary 24h session, so a
--     walked-away-from machine converted into permanent control or a full
--     plaintext export. Elevation needs to be revocable, and a claim in a cookie
--     is not revocable. It is a row here.
--
-- WHY ONE TABLE FOR BOTH. They are the same object: a nonce minted by us,
-- spendable once, expiring on a clock, attributable to a user. Two tables would
-- be two sweeps, two sets of indexes and two places to get the burn wrong.
--
-- THE SWEEP IS HOUSEKEEPING, NOT A GUARD — stated plainly so nobody wires a
-- dead-man's switch to it. Expiry is enforced by the `expires_at > now()`
-- predicate in `burnChallenge`, on every read, in the database. Deleting spent
-- rows only reclaims space. If the sweep stops, this table grows and nothing
-- becomes less safe; that is the opposite of the scheduler ledger, whose
-- ABSENCE is a silent failure and which is monitored for exactly that reason.
-- The sweep rides the heartbeat cron rather than adding a second scheduler.
--
-- DSQL: no FK constraints (user_id is app-enforced → users.id), no sequences,
-- indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Uniqueness on `jti` is NOT declared as a UNIQUE index — migration 002 is an
-- unapplied draft precisely because DSQL may not enforce UNIQUE on a secondary
-- index. It does not need to be: a jti is 128 bits of randomness from
-- `randomUUID()`, and the burn is a compare-and-set that can only ever succeed
-- once per row regardless.
--
-- Requirements: 17.1, J4-R9, J4-R11, J13-R1, J13-R2

CREATE TABLE IF NOT EXISTS auth_challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  jti         TEXT        NOT NULL,   -- the nonce carried in the signed token
  purpose     TEXT        NOT NULL,   -- registration | authentication | step-up
  user_id     UUID,                   -- app-enforced ref → users.id; NULL for identifier-free sign-in
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,            -- NULL = unspent. Set exactly once, by CAS.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_auth_challenges_jti ON auth_challenges (jti);
CREATE INDEX ASYNC idx_auth_challenges_expires ON auth_challenges (expires_at);
CREATE INDEX ASYNC idx_auth_challenges_user ON auth_challenges (user_id);
