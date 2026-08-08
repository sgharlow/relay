-- G1 lead capture for the paid caregiver funnel.
--
-- WHY THIS TABLE EXISTS. /caregivers/interest previously offered only a mailto:
-- link. Meta and Reddit traffic is overwhelmingly mobile, where that means
-- leaving the browser for an app many visitors have never configured — so the
-- funnel would have fired caregiver_intent (a pageview) while capturing almost
-- no contactable human. The gate would read as if it were working.
--
-- The row is deliberately paired with a notification email. Either one alone is
-- a single point of silent failure, and the failure mode is the dangerous one:
-- a broken capture path is indistinguishable from no demand, and the gate kills
-- below 0.5%. Two independent records make a break loud instead of quiet.
--
-- No owner_id and no FK: a lead is a stranger, not yet a user, and DSQL has no
-- FK constraints anyway (integrity lives in the application layer).
--
-- DSQL: CREATE INDEX ASYNC only, no sort order on index keys, no constraints on
-- ALTER TABLE ADD COLUMN.
--
-- Feature: relay-g1-wtp

CREATE TABLE IF NOT EXISTS caregiver_leads (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL,
  note          TEXT,
  -- Inbound channel and CTA position, carried from the landing page so a lead
  -- can be attributed to the ad that paid for it. Same vocabulary as the
  -- caregiver_qualified / caregiver_intent analytics events.
  src           TEXT,
  cta           TEXT,
  -- Whether the paired notification email was accepted by Resend. A row with
  -- notified = false is the signal that the email leg broke while the DB leg
  -- held; it is a lead that still needs a human reply.
  notified      BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC idx_caregiver_leads_created ON caregiver_leads (created_at);
CREATE INDEX ASYNC idx_caregiver_leads_email ON caregiver_leads (email);
