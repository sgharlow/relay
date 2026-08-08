-- Invitations: recipients and verifiers claim their role BEFORE any trigger
-- fires, so identity friction is spent in calm rather than during a crisis
-- (J4-R9).
--
-- Only a SHA-256 hash of the token is stored — a database read cannot mint a
-- working invitation link. Single use is enforced by claimed_at.
--
-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Requirements: J4-R9, J4-R10, J4-R11, CC7

CREATE TABLE IF NOT EXISTS invitations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL,
  person_id   UUID        NOT NULL,
  person_type TEXT        NOT NULL CHECK (person_type IN ('recipient','verifier')),
  token_hash  TEXT        NOT NULL,
  claimed_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_invitations_token_hash ON invitations (token_hash);
CREATE INDEX ASYNC idx_invitations_owner ON invitations (owner_id);

-- CC7: one human-readable case ID per release, quoted in every notification so
-- three parties on the phone share a referent. Derived from release_state.id,
-- persisted so it survives even if the derivation ever changes.
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS case_id TEXT;
