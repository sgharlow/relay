-- Delegation: a helper with scoped SETUP rights on another person's vault.
--
-- The caregiver wedge has three roles the schema treated as one — the buyer
-- (adult child), the data owner (parent), and the recipient (the child again).
-- The parent stays the owner; the child becomes a scoped delegate, and consent
-- is a first-class artifact rather than an assumption (J3-R1, J3-R2).
--
-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
--
-- Requirements: J3-R1, J3-R2, J3-R3, J3-R4, J3-R7

CREATE TABLE IF NOT EXISTS consent_artifacts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  method       TEXT        NOT NULL CHECK (method IN ('link','in_person','paper_upload')),
  evidence_ref TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delegations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID        NOT NULL,
  delegate_user_id    UUID        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','revoked')),
  -- The complete permitted set. No decrypt, no trigger control, no direct
  -- recipient creation: a delegate proposes, the owner approves.
  --
  -- JSONB, not TEXT[]: DSQL rejects array datatypes outright with
  -- "datatype text[] not supported".
  scopes              JSONB       NOT NULL DEFAULT
                        '["items:create","items:update","import:run","people:propose","policies:propose"]'::jsonb,
  consent_artifact_id UUID,
  granted_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_delegations_owner ON delegations (owner_id);
CREATE INDEX ASYNC idx_delegations_delegate ON delegations (delegate_user_id);

-- Provenance, so a delegate can be denied read access to items they did not
-- personally enter (J3-R4). NULL means the owner entered it.
ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS created_by_delegate_id UUID;
