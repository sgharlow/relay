-- Typed access codes for verifiers, replacing the credential-in-a-URL.
--
-- WHY. A verifier's confirmation link carried a signed JWT in the query string.
-- A token in a URL leaks in ways nobody plans for — browser history, referrer
-- headers, corporate proxy logs — and most likely of all, the verifier forwards
-- the email to a family member, handing over the ability to confirm a release.
--
-- It also taught the exact habit that gets people robbed. Smishing is the
-- fastest-growing fraud channel, and a product about credential safety should
-- not train anyone to click a link and be logged in. Once Relay NEVER sends a
-- login link, any email containing one is provably fake — but that rule only
-- has value if it is absolute.
--
-- THE CODE IS NOT THE CASE ID. `case_id` is derived deterministically from the
-- release_state id and is designed to be read aloud between four people during
-- a crisis; it is a public referent and must never authenticate anything. This
-- is a separate secret with a separate job.
--
-- Only the HASH is stored. A database leak must not yield the ability to
-- confirm a release, and nothing in the system ever needs the plaintext again
-- after the email is sent.
--
-- DSQL: CREATE INDEX ASYNC only, no FKs, no sort order on index keys.
--
-- Feature: relay-h0-mvp
-- Requirements: J7-R1, CC7

CREATE TABLE IF NOT EXISTS verifier_codes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the normalised code. The lookup key; the plaintext is never stored.
  code_hash         TEXT        NOT NULL,
  verifier_id       UUID        NOT NULL,
  release_state_id  UUID        NOT NULL,
  owner_id          UUID        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  -- Stamped when the code is successfully redeemed. Kept rather than deleted so
  -- a verifier who reloads the page is told their code was already used instead
  -- of being shown an indistinguishable "invalid code".
  redeemed_at       TIMESTAMPTZ,
  -- Failed attempts against THIS code, so a targeted guess is throttled even
  -- from a rotating set of addresses.
  failed_attempts   INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_verifier_codes_hash ON verifier_codes (code_hash);
CREATE INDEX ASYNC idx_verifier_codes_release ON verifier_codes (release_state_id);
