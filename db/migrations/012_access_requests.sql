-- Recipient-initiated access requests with owner-challenge-first.
--
-- Only the owner-truly-unreachable case should consume verifier attention:
-- escalating a false alarm burns the verification network's credibility for
-- nothing, and an owner who is conscious can simply approve (J6-R2).
--
-- DSQL: CREATE INDEX ASYNC, no sort order on index keys, and no constraints on
-- ALTER TABLE ADD COLUMN.
--
-- Requirements: J6-R1 .. J6-R12

CREATE TABLE IF NOT EXISTS access_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID        NOT NULL,
  recipient_id UUID        NOT NULL,
  trigger_type TEXT        NOT NULL
               CHECK (trigger_type IN ('emergency','travel','caregiver','business','estate')),
  reason       TEXT,
  evidence_ref TEXT,
  case_id      TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'awaiting_owner'
               CHECK (status IN ('awaiting_owner','denied_by_owner','approved_by_owner','escalated','closed')),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_access_requests_owner ON access_requests (owner_id, status);
CREATE INDEX ASYNC idx_access_requests_recipient ON access_requests (recipient_id);
