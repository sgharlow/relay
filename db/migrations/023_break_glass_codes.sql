-- Break-glass — the way back in for a contact who never claimed, and for one
-- whose authenticator is gone (docs/standby-architecture.md §3.6).
--
-- THE TENSION THIS CARRIES, stated rather than papered over (§8.1). Principle 2
-- says no standing credential is ever printed, and calls a single-use code that
-- dies on redemption something different. That holds — but for an UNCLAIMED
-- contact this code must be issuable before any claim, and then it sits unused
-- in a drawer for years. Until it is redeemed it is, functionally, the standing
-- printed credential this architecture exists to remove.
--
-- It is bounded rather than eliminated: single use, an expiry, an attempt
-- budget, an audit entry, a notification to the owner on use, and §4.3 excludes
-- a break-glass-only contact from counting toward N. The residual risk is
-- accepted deliberately, because the alternative is excluding the 70-year-old
-- with no smartphone from the circle entirely.
--
-- Shaped after recipient_codes (017) and verifier_codes (015) so the guard
-- behaves the way the rest of this codebase already does. Only a SHA-256 hash is
-- stored, so a database read cannot mint a working code.
--
-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Requirements: J4-R9, J4-R13

CREATE TABLE IF NOT EXISTS break_glass_codes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID        NOT NULL,   -- app-enforced ref → users.id
  person_id       UUID        NOT NULL,   -- recipients.id or verifiers.id
  person_type     TEXT        NOT NULL CHECK (person_type IN ('recipient','verifier')),
  code_hash       TEXT        NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  failed_attempts INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_break_glass_code_hash ON break_glass_codes (code_hash);
CREATE INDEX ASYNC idx_break_glass_owner ON break_glass_codes (owner_id);
