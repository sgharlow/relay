-- Standby accounts — the roster row is the RELATIONSHIP, the user row is the
-- IDENTITY (docs/standby-architecture.md §3.1).
--
-- Binding a contact to a user id rather than to an email address means someone
-- who changes address stays connected with no reconfiguration, and it is what
-- lets a release transmit nothing secret: the person signs into an account they
-- already have and the dashboard resolves server-side.
--
-- Every column here is NULLABLE, and deliberately so:
--   * DSQL cannot add NOT NULL to an existing table (migration 008 documents
--     this), and
--   * `standby_state` reads through a helper that maps NULL -> 'invited'
--     (lib/people/standby-state.ts), so existing rows need no backfill. This
--     mirrors how `case_id` was handled in 008.
--
-- Nothing in this migration changes a code path. It is additive only: the
-- release path, the auth path and the access path are untouched, so the
-- rollback for this sprint is reverting a render.
--
-- One user id may appear on MANY roster rows, across many owners — an owner can
-- also be someone else's standby. That is supported and expected, not an edge
-- case (§3.7). Uniqueness of (owner_id, claimed_user_id) is enforced in the
-- application layer per the existing no-FK convention, not by a constraint.
--
-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Requirements: J4-R9, J4-R10, J4-R11, J4-R13

ALTER TABLE recipients ADD COLUMN IF NOT EXISTS claimed_user_id UUID;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS email_secondary TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS standby_state TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS fingerprint_confirmed_at TIMESTAMPTZ;

ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS claimed_user_id UUID;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS email_secondary TEXT;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS standby_state TEXT;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS fingerprint_confirmed_at TIMESTAMPTZ;

-- Two timestamps replace the three state-splits the original brief proposed.
-- Nothing behaves differently on either, so they are facts to record, not states
-- to transition through: PERMITTED_TRANSITIONS stays at seven.
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE release_state ADD COLUMN IF NOT EXISTS first_access_at TIMESTAMPTZ;

CREATE INDEX ASYNC idx_recipients_claimed_user ON recipients (claimed_user_id);
CREATE INDEX ASYNC idx_verifiers_claimed_user ON verifiers (claimed_user_id);
