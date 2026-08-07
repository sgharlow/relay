-- Entitlements. G4 (Stripe) is gated behind G1/G2, so this table carries only
-- the tier — enough to enforce free-tier caps server-side now, with a payment
-- processor wired in later.
--
-- DSQL: indexes must be created ASYNC and cannot specify a sort order on keys.
--
-- Requirements: J1-R7, J1-R8

CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL,
  tier        TEXT        NOT NULL DEFAULT 'free' CHECK (tier IN ('free','paid')),
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  price_cents INT,
  cohort      TEXT,       -- price-test cohort for G1
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_subscriptions_owner ON subscriptions (owner_id);
