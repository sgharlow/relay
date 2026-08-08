-- Typed access codes for recipients.
--
-- Mirrors 015 for verifiers. The recipient link is the HIGHER-value credential
-- of the two — it opens the vault rather than asking one question — so the
-- argument for getting the token out of the URL is stronger here, not weaker.
--
-- It was done second on purpose. A recipient is far more motivated than a
-- verifier to push through the friction of typing a code, so the conversion
-- risk was worth measuring on the cheaper path first.
--
-- Only the hash is stored. Codes are single-use and expire with the access
-- window they belong to.
--
-- DSQL: CREATE INDEX ASYNC only, no FKs.
--
-- Feature: relay-h0-mvp
-- Requirements: 7.1, J8-R1

CREATE TABLE IF NOT EXISTS recipient_codes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash         TEXT        NOT NULL,
  recipient_id      UUID        NOT NULL,
  release_state_id  UUID        NOT NULL,
  owner_id          UUID        NOT NULL,
  -- The release version the code was minted against. A re-arm bumps the
  -- version, and a code carrying a stale one must die with the token it stands
  -- in for — otherwise typing a code would outlive the access it represents.
  release_version   TEXT        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  redeemed_at       TIMESTAMPTZ,
  failed_attempts   INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_recipient_codes_hash ON recipient_codes (code_hash);
CREATE INDEX ASYNC idx_recipient_codes_release ON recipient_codes (release_state_id);
