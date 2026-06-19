-- ============================================================
-- Relay H0 MVP — Initial Schema Migration
-- 001_initial.sql
--
-- DSQL notes:
--   • No FK constraints enforced by the DB — all referential
--     integrity is enforced in application logic (lib/db/integrity.ts).
--   • OCC: Aurora DSQL uses snapshot isolation; conflicting concurrent
--     writes fail with SQLSTATE 40001. All state mutations use a
--     CAS UPDATE (WHERE id=? AND state=? AND version=?) with
--     exponential-backoff retry (base 100 ms, jitter ±50 ms, max 1 s,
--     max 3 attempts). On exhaustion the system defaults to ARMED.
--   • No SEQUENCE / SERIAL / BIGSERIAL — gen_random_uuid() provides
--     UUID PKs that distribute writes across DSQL nodes and avoid
--     the sequential-ID anti-pattern.
--   • Covering indexes (INCLUDE clause) allow owner-scoped list queries
--     to be satisfied from the index without touching the main heap
--     (especially important for vault_items where ciphertext is large).
--   • The audit_log table is INSERT-only; no UPDATE or DELETE is ever
--     issued against it. Monotonicity of seq is maintained by reading
--     MAX(seq)+1 inside the same OCC transaction.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. users
-- ------------------------------------------------------------------
CREATE TABLE users (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT         NOT NULL,
  auth_sub              TEXT         NOT NULL,        -- OAuth / Clerk subject
  status                TEXT         NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended')),
  last_active_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  checkin_interval_days INT          NOT NULL DEFAULT 30
                        CHECK (checkin_interval_days BETWEEN 1 AND 365),
  is_demo_account       BOOLEAN      NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_auth_sub ON users (auth_sub);
CREATE INDEX idx_users_email    ON users (email);

-- ------------------------------------------------------------------
-- 2. recipients
-- ------------------------------------------------------------------
CREATE TABLE recipients (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID         NOT NULL,   -- app-enforced ref → users.id
  name         TEXT         NOT NULL,
  relationship TEXT,
  email        TEXT         NOT NULL,
  phone        TEXT,
  role         TEXT         NOT NULL
               CHECK (role IN ('recipient', 'executor', 'caregiver', 'partner')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_recipients_owner ON recipients (owner_id);

-- ------------------------------------------------------------------
-- 3. verifiers
-- ------------------------------------------------------------------
CREATE TABLE verifiers (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID         NOT NULL,   -- app-enforced ref → users.id
  name                TEXT         NOT NULL,
  email               TEXT         NOT NULL,
  phone               TEXT,
  verification_status TEXT         NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_verifiers_owner ON verifiers (owner_id);

-- ------------------------------------------------------------------
-- 4. vault_items
-- ------------------------------------------------------------------
CREATE TABLE vault_items (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID          NOT NULL,   -- app-enforced ref → users.id
  type               TEXT          NOT NULL
                     CHECK (type IN ('login', 'account', 'document', 'note', 'instruction')),
  title              TEXT          NOT NULL
                     CHECK (char_length(title) BETWEEN 1 AND 200),
  service_name       TEXT,
  url                TEXT
                     CHECK (char_length(url) <= 2048),
  category           TEXT
                     CHECK (category IN (
                       'finance', 'health', 'government', 'utilities',
                       'communication', 'professional', 'personal', 'other'
                     )),
  criticality        TEXT
                     CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
  -- importance engine flags (non-secret; ZK-preserving — never sent to AI agents)
  is_root_credential BOOLEAN       NOT NULL DEFAULT false,
  recurring_billing  BOOLEAN       NOT NULL DEFAULT false,
  irreplaceable      BOOLEAN       NOT NULL DEFAULT false,
  importance_score   NUMERIC(4,3)  NOT NULL DEFAULT 0.5
                     CHECK (importance_score BETWEEN 0.0 AND 1.0),
  depends_on_item_id UUID          NULL,       -- app-enforced self-ref; risk-graph edge
  backup_note        TEXT,
  -- encrypted payload (ciphertext columns excluded from AI / metadata queries)
  ciphertext         BYTEA         NOT NULL,
  wrapped_data_key   BYTEA         NOT NULL,
  kms_key_id         TEXT          NOT NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Covering index for owner vault list scans.
-- The INCLUDE columns (title, service_name, url, type, is_root_credential) are
-- readable from the index alone, so list queries never touch the large
-- ciphertext / wrapped_data_key columns stored in the main heap.
CREATE INDEX idx_vault_items_owner ON vault_items
  (owner_id, category, criticality, importance_score DESC)
  INCLUDE (title, service_name, url, type, is_root_credential);

-- ------------------------------------------------------------------
-- 5. access_rules
-- ------------------------------------------------------------------
CREATE TABLE access_rules (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID         NOT NULL,   -- app-enforced ref → users.id
  vault_item_id      UUID         NOT NULL,   -- app-enforced ref → vault_items.id
  recipient_id       UUID         NOT NULL,   -- app-enforced ref → recipients.id
  trigger_type       TEXT         NOT NULL
                     CHECK (trigger_type IN (
                       'emergency', 'travel', 'caregiver', 'business', 'estate'
                     )),
  scope              TEXT         NOT NULL
                     CHECK (scope IN ('view', 'act')),
  reversible         BOOLEAN      NOT NULL,
  release_after_days INT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Estate triggers must be irreversible (Requirement 3.5).
  -- Enforced here as a belt-and-suspenders CHECK; also enforced in app logic.
  CONSTRAINT chk_estate_irreversible
    CHECK (trigger_type != 'estate' OR reversible = false)
);

CREATE INDEX idx_access_rules_owner     ON access_rules (owner_id);
CREATE INDEX idx_access_rules_item      ON access_rules (vault_item_id);
CREATE INDEX idx_access_rules_recipient ON access_rules (recipient_id);

-- ------------------------------------------------------------------
-- 6. release_state
-- ------------------------------------------------------------------
-- One row per (owner_id, trigger_type). Uniqueness is app-enforced via an
-- OCC intent-read before INSERT; DSQL does not enforce UNIQUE constraints
-- on distributed clusters the same way single-node Postgres does.
CREATE TABLE release_state (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID         NOT NULL,   -- app-enforced ref → users.id
  trigger_type           TEXT         NOT NULL
                         CHECK (trigger_type IN (
                           'emergency', 'travel', 'caregiver', 'business', 'estate'
                         )),
  state                  TEXT         NOT NULL DEFAULT 'armed'
                         CHECK (state IN ('armed', 'pending', 'grace', 'released', 'cancelled')),
  required_confirmations INT          NOT NULL DEFAULT 1,
  received_confirmations INT          NOT NULL DEFAULT 0,
  version                BIGINT       NOT NULL DEFAULT 0,  -- OCC CAS guard column
  initiated_by           TEXT,
  initiated_at           TIMESTAMPTZ,
  grace_ends_at          TIMESTAMPTZ,
  released_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Compound index supports the common query pattern:
--   SELECT * FROM release_state WHERE owner_id = $1 AND trigger_type = $2
CREATE INDEX idx_release_state_owner_type ON release_state (owner_id, trigger_type);

-- ------------------------------------------------------------------
-- 7. verifier_confirmations
-- ------------------------------------------------------------------
-- Per-release-state confirmation records. Idempotency (one confirmation per
-- verifier per release_state instance) is enforced in application logic using
-- an OCC intent-read; duplicate submissions are silently ignored.
CREATE TABLE verifier_confirmations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  release_state_id UUID         NOT NULL,   -- app-enforced ref → release_state.id
  verifier_id      UUID         NOT NULL,   -- app-enforced ref → verifiers.id
  confirmed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  method           TEXT         NOT NULL
                   CHECK (method IN ('app', 'document', 'manual'))
);

CREATE INDEX idx_verifier_confirmations_release ON verifier_confirmations (release_state_id);

-- ------------------------------------------------------------------
-- 8. audit_log
-- ------------------------------------------------------------------
-- Append-only, hash-chained tamper-evident log (Requirement 8).
-- No UPDATE or DELETE is ever issued against this table.
-- Chain integrity:
--   entry_hash = SHA-256(prev_hash || canonical_json(entry))
--   prev_hash  = entry_hash of prior row for same owner_id
--              = '0000...0' (64 hex zeros) for the first entry per owner
-- Monotonic seq is maintained by reading MAX(seq)+1 inside the same
-- OCC transaction; retried on SQLSTATE 40001.
CREATE TABLE audit_log (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID         NOT NULL,
  seq        BIGINT       NOT NULL,   -- monotonically increasing per owner_id
  actor      TEXT         NOT NULL,   -- 'owner:<id>' | 'recipient:<id>' | 'system' | 'cron'
  action     TEXT         NOT NULL,
  entity     TEXT         NOT NULL,
  entity_id  UUID,
  detail     JSONB        NOT NULL DEFAULT '{}',
  prev_hash  TEXT         NOT NULL,   -- entry_hash of prior entry (or 64 zero chars for first)
  entry_hash TEXT         NOT NULL,   -- SHA-256(prev_hash || canonical(entry))
  ts         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Primary access pattern: owner-scoped ascending seq read for the audit viewer.
CREATE INDEX idx_audit_log_owner_seq ON audit_log (owner_id, seq ASC);
