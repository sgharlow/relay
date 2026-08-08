-- Stripe identifiers on the existing subscriptions table.
--
-- The table already carried tier and status; what it lacked was any way to tie
-- a row back to the Stripe objects that produced it. Without that, a webhook
-- for a cancellation cannot find the row it belongs to, and a customer cannot
-- be sent to the billing portal to manage their own subscription.
--
-- SHARED STRIPE ACCOUNT. This account also serves report-bridge and
-- skillcrossroads. Relay adds its own product, price and webhook endpoint —
-- all additive. Nothing existing is modified, and the API key is never rolled.
--
-- DSQL: no constraints on ALTER TABLE ADD COLUMN.
--
-- Feature: relay-h0-mvp
-- Requirements: J12-R1

ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN current_period_end TIMESTAMPTZ;

CREATE INDEX ASYNC idx_subscriptions_stripe_sub ON subscriptions (stripe_subscription_id);
CREATE INDEX ASYNC idx_subscriptions_stripe_cust ON subscriptions (stripe_customer_id);
