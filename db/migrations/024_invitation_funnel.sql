-- Phase 0 instrumentation — make claim conversion a funnel rather than a number.
--
-- The architecture bets everything on claim conversion (docs/standby-architecture.md
-- risk 1), and the sprint plan records that the measurement as originally
-- specified could not bear that weight. One confound is now gone: the claim flow
-- used to terminate at an acknowledgment, and since sprint C1 it binds a real
-- identity and mints a session, so completing it means what we need it to mean.
--
-- The other confound is DELIVERY. The invitation rode the channel measured broken
-- on 2026-08-11 (Outlook at SCL 5, Resend suppression returning 200), so a low
-- number would be uninterpretable: "never arrived" and "would not claim" produce
-- exactly the same result. These three columns separate them.
--
--   delivery_channel — 'email' or 'owner'. Splitting the cohort is what isolates
--                      delivery: if the owner-delivered arm converts and the
--                      email arm does not, the problem is the channel, not the
--                      ask.
--   opened_at        — the claim page loaded with this code. Distinguishes
--                      "never got it" from "got it and did not finish", which are
--                      different problems with different fixes.
--   cohort           — a free-text tag so a deliberate run can be read apart from
--                      ordinary traffic. Without it the first real users would be
--                      averaged into the experiment.
--
-- With created_at and claimed_at already present, the funnel becomes
-- issued -> opened -> claimed, per channel.
--
-- All nullable: DSQL cannot add NOT NULL to an existing table (see 008), and
-- existing invitations legitimately have no cohort.
--
-- Requirements: J4-R9

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS delivery_channel TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS cohort TEXT;
