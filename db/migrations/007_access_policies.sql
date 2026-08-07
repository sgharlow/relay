-- Access policies: predicates over item attributes that MATERIALIZE into
-- access_rules.
--
-- access_rules remains the SOLE authority consulted by the KMS unwrap path
-- (Property 6). This table only generates rows in it — it never becomes an
-- alternate authority (J4-R3).
--
-- DSQL: indexes must be CREATE INDEX ASYNC and cannot specify a sort order.
--
-- Requirements: J4-R3, J4-R4, J4-R6, J4-R14, J4-R15

CREATE TABLE IF NOT EXISTS access_policies (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID        NOT NULL,
  recipient_id UUID        NOT NULL,
  trigger_type TEXT        NOT NULL
               CHECK (trigger_type IN ('emergency','travel','caregiver','business','estate')),
  scope        TEXT        NOT NULL CHECK (scope IN ('view','act')),
  reversible   BOOLEAN     NOT NULL,
  predicate    JSONB       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors chk_estate_irreversible on access_rules: an estate policy can only
  -- ever materialise irreversible grants.
  CONSTRAINT chk_policy_estate_irreversible
    CHECK (trigger_type != 'estate' OR reversible = false)
);

CREATE INDEX ASYNC idx_access_policies_owner ON access_policies (owner_id);

-- Provenance, so reconciliation can tell a generated grant from a hand-made one
-- and only ever revoke its own.
ALTER TABLE access_rules ADD COLUMN IF NOT EXISTS policy_id UUID;

CREATE INDEX ASYNC idx_access_rules_policy ON access_rules (policy_id);
