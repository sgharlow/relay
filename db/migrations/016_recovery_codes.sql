-- Recovery codes: getting back in after losing the authenticator.
--
-- WHY THIS IS MVP-BLOCKING. Relay has no password. Authentication is an email
-- address plus a TOTP code, and until now there was no path back if the phone
-- holding that authenticator was lost, replaced, wiped or died. For a 74-year-old
-- owner over a five-year horizon that is not an edge case, it is the expected
-- case — and the failure was total and permanent.
--
-- WHAT IT ACTUALLY COSTS, which is less than the terms page claims. Data keys
-- come from AWS KMS and are unwrapped server-side for an authenticated caller;
-- no key material is derived from anything the owner holds. Losing the
-- authenticator therefore loses LOGIN, not DATA. This is an authentication
-- problem, and recovery codes are the whole solution.
--
-- Only hashes are stored. The codes are high-entropy (10 characters over a
-- 31-character alphabet, ~50 bits each), so SHA-256 is appropriate — these are
-- not user-chosen passwords needing a slow KDF, and a fast hash keeps the
-- verify path cheap.
--
-- Single-use: `used_at` is stamped on redemption and a used code never works
-- again, so a code read over someone's shoulder has a short useful life.
--
-- DSQL: CREATE INDEX ASYNC only, no FKs.
--
-- Feature: relay-h0-mvp
-- Requirements: J11-R1

CREATE TABLE IF NOT EXISTS recovery_codes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  code_hash  TEXT        NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_recovery_codes_user ON recovery_codes (user_id);
CREATE INDEX ASYNC idx_recovery_codes_hash ON recovery_codes (code_hash);
