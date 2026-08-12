-- Passkeys — stage two of the two-stage claim (docs/standby-architecture.md [A1]).
--
-- A standby contact binds a device in stage one and can defer this. When they do
-- register a passkey, it is what lets them come back on a NEW device without the
-- owner reissuing anything — and it is phishing-resistant by construction, which
-- is what makes "Relay never sends a link that signs you in" an architectural
-- statement rather than a promise.
--
-- STORAGE DEVIATION FROM THE ORIGINAL SKETCH, DELIBERATE. The pivot proposed
-- `public_key BYTEA`. This stores base64url TEXT instead:
--   * @simplewebauthn/server v13 hands back a Uint8Array either way, so the
--     conversion is one call at the boundary, and
--   * every other credential in this schema (token_hash, code_hash) is already
--     TEXT, so this needs no new driver behaviour on Aurora DSQL.
-- Choosing the type this data layer already round-trips beats matching a sketch.
--
-- `counter` is the signature counter. Postgres returns BIGINT as a string
-- through node-postgres, so readers must Number() it — the same care the OCC
-- `version` column already needs.
--
-- No UNIQUE index on credential_id: migration 002 is a draft that was never
-- applied precisely because Aurora DSQL may not enforce UNIQUE secondary
-- indexes. Uniqueness is enforced in the application layer on the read path,
-- the same trade the rest of this data layer makes.
--
-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Requirements: J4-R9, J4-R11

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,   -- app-enforced ref → users.id
  credential_id TEXT        NOT NULL,   -- base64url
  public_key    TEXT        NOT NULL,   -- base64url
  counter       BIGINT      NOT NULL DEFAULT 0,
  transports    TEXT,                   -- comma-joined hints, advisory only
  device_label  TEXT,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_webauthn_credential_id ON webauthn_credentials (credential_id);
CREATE INDEX ASYNC idx_webauthn_user ON webauthn_credentials (user_id);
