-- 031 — the send-side half of the mail dead-man's switch.
--
-- 🔴 THE SWITCH HAD BEEN PERMANENTLY DISARMED SINCE ITS FIRST EVENT.
-- `getDeliveryWebhookHealth` decided `healthy` from `count(*) > 0` over
-- `email_delivery_events`, which is append-only. Once the first event ever
-- landed — and 113 rows had — that condition was true forever. The Resend
-- webhook could be deleted from the dashboard, or its signing secret rotated,
-- and `/api/health/delivery-webhook` would answer 200 for the rest of time.
--
-- Everything above it was real and wired: a public health endpoint, a daily
-- GitHub Actions probe hosted off Vercel so it could outlive the thing it
-- watches, a retry so it would not cry wolf, and an error message naming the
-- three things to check. All of it hanging off a condition that could no longer
-- become false. The workflow's own header describes the failure — "that endpoint
-- can be deleted in a dashboard ... and nothing in the application would
-- notice" — and that stayed exactly true with the monitor running.
--
-- WHY A NEW TABLE RATHER THAN A CLEVERER QUERY. lib/notify/webhook-health.ts
-- says in its header what the real check would be: "we accepted N sends and
-- heard nothing back" — and then that it is impossible, because the only
-- send-side record is `lib/notify/transcript.ts`, which is in-memory and refuses
-- to arm in production BY DESIGN, since message bodies carry live access codes.
-- That reasoning is right about transcript and wrong about the conclusion: the
-- switch does not need the message, only the fact that one was accepted.
--
-- SO THIS TABLE HOLDS NO RECIPIENT AND NO BODY — just Resend's own id and a
-- timestamp. It is strictly less personal data than the events table it is
-- compared against, and `provider_id` is the exact join: the id the send API
-- returns is the `email_id` the webhook echoes back.
--
-- Append-only, like email_delivery_events and audit_log. One row per outbound
-- message on a product that sends rarely by design; if that ever stops being
-- true, this is a retention question, not a correctness one.

CREATE TABLE IF NOT EXISTS email_send_attempts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resend's message id, returned by the send API and echoed by the webhook as
  -- `data.email_id`. NOT NULL: an attempt we cannot join to an event tells us
  -- nothing, and recording one would only make the switch harder to trust.
  provider_id  TEXT         NOT NULL,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- DSQL: indexes must be CREATE INDEX ASYNC with no sort order on keys.
-- provider_id is the join key; occurred_at bounds the window the health check
-- judges, so both are read on every probe.
CREATE INDEX ASYNC idx_email_send_attempts_provider ON email_send_attempts (provider_id);
CREATE INDEX ASYNC idx_email_send_attempts_at ON email_send_attempts (occurred_at);
