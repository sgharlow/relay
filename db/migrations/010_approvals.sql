-- Owner approval queue for delegate proposals.
--
-- A delegate proposes; the owner approves. The case this exists for is a
-- delegate designating THEMSELVES as a recipient — nothing a helper does may
-- grant themselves access (J3-R6).
--
-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Requirements: J3-R6, J3-R8

CREATE TABLE IF NOT EXISTS approvals (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  UUID        NOT NULL,
  kind                      TEXT        NOT NULL
                            CHECK (kind IN ('recipient','policy','self_designation')),
  payload                   JSONB       NOT NULL,
  proposed_by_delegation_id UUID,
  status                    TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at                TIMESTAMPTZ
);

CREATE INDEX ASYNC idx_approvals_owner_status ON approvals (owner_id, status);
